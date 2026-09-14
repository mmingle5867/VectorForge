import type { Prisma } from '@prisma/client';
import { SemaCore, parseInstallationId, parseKeyId, type JsonObject } from '@selo/sema-core';

import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { consumeReservedIdentifierInTransaction, PrismaSemaCoreStore, reserveIdentifiersInTransaction } from '@/services/sema-core-prisma-store';

export type SemaIdentifierTypeCode = string;
export interface IssuedSemaIdentifier { id: string; installationId: string; localValue: bigint; localToken: string; typeCode?: string; }
type IdentityTransaction = Prisma.TransactionClient;

const store = new PrismaSemaCoreStore();
const core = new SemaCore(store, { installationId: parseInstallationId(config.sema.installationId), maxReservationSize: 100 });
const asIssued = (value: { id: string; installationId: string; localValue: bigint; localCode: string; typeCode?: string }): IssuedSemaIdentifier => ({ id: value.id, installationId: value.installationId, localValue: value.localValue, localToken: value.localCode, typeCode: value.typeCode });

export async function getSemaCoreIdentityState() { return core.initialize(); }

/** Shared SEMA Core issuance. The adapter records reservation and consumption in PostgreSQL. */
export async function issueSemaIdentifier(typeCode?: SemaIdentifierTypeCode, metadata: Prisma.InputJsonValue = {}): Promise<IssuedSemaIdentifier> {
  return asIssued(await core.issueIdentifier(typeCode, metadata as JsonObject));
}

/** Transaction-aware adapter for existing VectorForge writes using the shared reservation ledger. */
export async function issueSemaIdentifierInTransaction(tx: IdentityTransaction, typeCode?: SemaIdentifierTypeCode, metadata: Prisma.InputJsonValue = {}): Promise<IssuedSemaIdentifier> {
  await core.initialize();
  const { reservation, identifiers } = await reserveIdentifiersInTransaction(tx, { count: 1, typeCode, metadata: metadata as JsonObject });
  return asIssued(await consumeReservedIdentifierInTransaction(tx, reservation.id, identifiers[0]!.id, metadata as JsonObject));
}

export async function reserveSemaIdentifiers(count: number, typeCode?: SemaIdentifierTypeCode, metadata: Prisma.InputJsonValue = {}) { await core.initialize(); return core.reserveIdentifiers(count, typeCode, metadata as JsonObject); }
export async function consumeReservedSemaIdentifier(reservationId: string, id: string, metadata: Prisma.InputJsonValue = {}) { return asIssued(await core.consumeReservedIdentifier(id, reservationId, metadata as JsonObject)); }
export async function issueChildInstallationId(metadata: Prisma.InputJsonValue = {}) { return (await core.issueChildInstallation(metadata as JsonObject)).id; }
export async function inspectSemaIdentifier(id: string) { return { ...parseKeyId(id), issued: await prisma.semaIssuedIdentifier.findUnique({ where: { semaId: id } }) }; }
