import { Prisma } from '@prisma/client';
import { encodeBase56, formatKeyId, normalizeTypeCode, type CoreAuditEntry, type CoreCapability, type CoreCommand, type CoreEvent, type CoreExecution, type CoreResult, type JsonObject, type SemaCoreStore, type SemaIdentifier, type SemaIdentifierReservation } from '@selo/sema-core';

import prisma from '@/lib/prisma';

const STATE_KEY = 'PRIMARY';
type Db = Prisma.TransactionClient;
const json = (value: Prisma.JsonValue | null): JsonObject => (value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {});
const subjects = (value: Prisma.JsonValue): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

async function reserve(tx: Db, input: { count: number; typeCode?: string; metadata: JsonObject }) {
  const rows = await tx.$queryRaw<Array<{ installationId: string; localValue: bigint }>>`
    UPDATE "sema_core_identity_state" SET "nextLocalId" = "nextLocalId" + ${BigInt(input.count)}, "updatedAt" = NOW()
    WHERE "stateKey" = ${STATE_KEY} AND "status" = 'ACTIVE'
    RETURNING "installationId", "nextLocalId" - ${BigInt(input.count)} AS "localValue"
  `;
  const start = rows[0]; if (!start) throw new Error('SEMA Core KeyID allocator is unavailable');
  const reservationId = formatKeyId({ installationId: start.installationId, localValue: start.localValue });
  const firstLocalValue = start.localValue;
  const typeCode = input.typeCode ? normalizeTypeCode(input.typeCode) : undefined;
  const reservation: SemaIdentifierReservation = { id: reservationId, installationId: start.installationId, firstLocalValue, count: input.count, typeCode, metadata: input.metadata, createdAt: new Date() };
  await tx.semaIdentifierReservation.create({ data: { id: reservationId, installationId: start.installationId, firstLocalValue, count: input.count, typeCode, metadata: input.metadata } });
  const identifiers: SemaIdentifier[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const localValue = firstLocalValue + BigInt(index);
    const id = formatKeyId({ installationId: start.installationId, localValue });
    await tx.semaIssuedIdentifier.create({ data: { semaId: id, installationId: start.installationId, localValue, localCode: encodeBase56(localValue), typeCode, reservationId, status: 'RESERVED', metadata: input.metadata } });
    identifiers.push({ id, reservationId, installationId: start.installationId, localValue, localCode: encodeBase56(localValue), typeCode, status: 'RESERVED', metadata: input.metadata });
  }
  return { reservation, identifiers };
}

export async function reserveIdentifiersInTransaction(tx: Db, input: { count: number; typeCode?: string; metadata: JsonObject }) { return reserve(tx, input); }
export async function consumeReservedIdentifierInTransaction(tx: Db, reservationId: string, id: string, metadata: JsonObject = {}) {
  const row = await tx.semaIssuedIdentifier.findUnique({ where: { semaId: id } });
  if (!row || row.reservationId !== reservationId) throw new Error('Identifier is not in this reservation');
  if (row.status !== 'RESERVED') throw new Error('Identifier has already been consumed');
  const updated = await tx.semaIssuedIdentifier.update({ where: { semaId: id }, data: { status: 'ISSUED', consumedAt: new Date(), metadata: { ...json(row.metadata), ...metadata } } });
  return { id: updated.semaId, reservationId, installationId: updated.installationId, localValue: updated.localValue, localCode: updated.localCode, typeCode: updated.typeCode ?? undefined, status: 'ISSUED' as const, metadata: json(updated.metadata) };
}

export class PrismaSemaCoreStore implements SemaCoreStore {
  async initializeIdentity(installationId: string) {
    const state = await prisma.semaCoreIdentityState.upsert({ where: { stateKey: STATE_KEY }, update: {}, create: { stateKey: STATE_KEY, installationId, nextLocalId: BigInt(1) } });
    if (state.installationId !== installationId || state.status !== 'ACTIVE') throw new Error('SEMA Core installation is unavailable');
    return { installationId: state.installationId, nextLocalId: state.nextLocalId, status: state.status as 'ACTIVE' | 'SUSPENDED' };
  }
  async reserveIdentifiers(input: { count: number; typeCode?: string; metadata: JsonObject }) { return prisma.$transaction((tx) => reserve(tx, input)); }
  async consumeReservedIdentifier(reservationId: string, id: string, metadata: JsonObject = {}) { return prisma.$transaction((tx) => consumeReservedIdentifierInTransaction(tx, reservationId, id, metadata)); }
  async createCommand(command: CoreCommand) { await prisma.semaCoreCommand.create({ data: { ...command, subjectIds: command.subjectIds, context: command.context, payload: command.payload } }); return command; }
  async updateCommand(id: string, update: Partial<Pick<CoreCommand, 'status'>>) { const row = await prisma.semaCoreCommand.update({ where: { id }, data: update }); return { ...row, subjectIds: subjects(row.subjectIds), context: json(row.context), payload: json(row.payload), status: row.status as CoreCommand['status'] }; }
  async createExecution(execution: CoreExecution) { await prisma.semaCoreExecution.create({ data: { ...execution, context: execution.context, error: execution.error ?? Prisma.JsonNull } }); return execution; }
  async updateExecution(id: string, update: Partial<Pick<CoreExecution, 'status' | 'completedAt' | 'error'>>) { const data = { ...(update.status !== undefined ? { status: update.status } : {}), ...(update.completedAt !== undefined ? { completedAt: update.completedAt } : {}), ...(update.error !== undefined ? { error: update.error ?? Prisma.JsonNull } : {}) }; const row = await prisma.semaCoreExecution.update({ where: { id }, data }); return { ...row, context: json(row.context), error: row.error ? json(row.error) : null, status: row.status as CoreExecution['status'] }; }
  async createResult(result: CoreResult) { await prisma.semaCoreResult.create({ data: { ...result, subjectIds: result.subjectIds, data: result.data } }); return result; }
  async createEvent(event: CoreEvent) { await prisma.semaCoreEvent.create({ data: { ...event, subjectIds: event.subjectIds, data: event.data } }); return event; }
  async createAudit(entry: CoreAuditEntry) { await prisma.semaCoreAuditEntry.create({ data: { ...entry, subjectIds: entry.subjectIds, evidence: entry.evidence } }); return entry; }
  async upsertCapability(capability: CoreCapability) { const row = await prisma.semaCoreCapability.upsert({ where: { capabilityKey: capability.capabilityKey }, create: { ...capability, metadata: capability.metadata }, update: { displayName: capability.displayName, description: capability.description, providerKey: capability.providerKey, version: capability.version, status: capability.status, metadata: capability.metadata } }); return { ...capability, id: row.id, metadata: json(row.metadata), status: row.status as CoreCapability['status'] }; }
  async findCapability(capabilityKey: string) { const row = await prisma.semaCoreCapability.findUnique({ where: { capabilityKey } }); return row ? { ...row, metadata: json(row.metadata), status: row.status as CoreCapability['status'] } : null; }
  async listCapabilities(query: string) { const rows = await prisma.semaCoreCapability.findMany({ where: { status: 'ACTIVE', ...(query ? { OR: [{ capabilityKey: { contains: query, mode: 'insensitive' } }, { displayName: { contains: query, mode: 'insensitive' } }] } : {}) }, orderBy: { displayName: 'asc' } }); return rows.map((row) => ({ ...row, metadata: json(row.metadata), status: row.status as CoreCapability['status'] })); }
}
