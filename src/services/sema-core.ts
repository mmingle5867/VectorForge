import type { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { issueSemaIdentifier, issueSemaIdentifierInTransaction } from '@/services/sema-core-identity';

export type CoreLifecycleStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'CANCELLED' | 'FAILED' | 'SUCCESS';

export interface CreateCoreCommandInput {
  commandType: string;
  actorId?: string | null;
  workspaceId?: string | null;
  subjectIds?: string[];
  context?: Prisma.InputJsonValue;
  payload?: Prisma.InputJsonValue;
}

export async function createCoreCommand(input: CreateCoreCommandInput) {
  const issued = await issueSemaIdentifier('COMMAND', { commandType: input.commandType });
  return prisma.semaCoreCommand.create({
    data: {
      id: issued.id,
      commandType: input.commandType,
      actorId: input.actorId ?? null,
      workspaceId: input.workspaceId ?? null,
      subjectIds: input.subjectIds ?? [],
      context: input.context ?? {},
      payload: input.payload ?? {},
      status: 'PENDING',
    },
  });
}

export async function startCoreExecution(input: {
  commandId: string;
  providerId?: string | null;
  context?: Prisma.InputJsonValue;
}) {
  return prisma.$transaction(async (tx) => {
    const issued = await issueSemaIdentifierInTransaction(tx, 'EXECUTION', { commandId: input.commandId });
    await tx.semaCoreCommand.update({ where: { id: input.commandId }, data: { status: 'RUNNING' } });
    return tx.semaCoreExecution.create({
      data: {
        id: issued.id,
        commandId: input.commandId,
        providerId: input.providerId ?? null,
        context: input.context ?? {},
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
  });
}

export async function completeCoreExecution(input: {
  executionId: string;
  status: Extract<CoreLifecycleStatus, 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'WAITING'>;
  resultType?: string;
  subjectIds?: string[];
  result?: Prisma.InputJsonValue;
  error?: Prisma.InputJsonValue;
}) {
  return prisma.$transaction(async (tx) => {
    const execution = await tx.semaCoreExecution.update({
      where: { id: input.executionId },
      data: { status: input.status, completedAt: new Date(), error: input.error },
    });
    const commandStatus = input.status === 'SUCCESS' ? 'SUCCESS' : input.status;
    await tx.semaCoreCommand.update({ where: { id: execution.commandId }, data: { status: commandStatus } });

    let result = null;
    if (input.resultType) {
      const issued = await issueSemaIdentifierInTransaction(tx, 'RESULT', { executionId: execution.id });
      result = await tx.semaCoreResult.create({
        data: { id: issued.id, executionId: execution.id, resultType: input.resultType, subjectIds: input.subjectIds ?? [], data: input.result ?? {} },
      });
    }
    const event = await recordCoreEventInTransaction(tx, {
      eventType: `execution.${input.status.toLowerCase()}`,
      commandId: execution.commandId,
      executionId: execution.id,
      subjectIds: input.subjectIds,
      data: input.result ?? input.error ?? {},
    });
    return { execution, result, event };
  });
}

export async function recordCoreEvent(input: {
  eventType: string;
  commandId?: string | null;
  executionId?: string | null;
  subjectIds?: string[];
  data?: Prisma.InputJsonValue;
}) {
  return prisma.$transaction((tx) => recordCoreEventInTransaction(tx, input));
}

async function recordCoreEventInTransaction(
  tx: Prisma.TransactionClient,
  input: { eventType: string; commandId?: string | null; executionId?: string | null; subjectIds?: string[]; data?: Prisma.InputJsonValue }
) {
  const issued = await issueSemaIdentifierInTransaction(tx, 'EVENT', { eventType: input.eventType });
  return tx.semaCoreEvent.create({
    data: { id: issued.id, eventType: input.eventType, commandId: input.commandId ?? null, executionId: input.executionId ?? null, subjectIds: input.subjectIds ?? [], data: input.data ?? {} },
  });
}

export async function recordCoreAudit(input: {
  action: string;
  actorId?: string | null;
  commandId?: string | null;
  executionId?: string | null;
  subjectIds?: string[];
  evidence?: Prisma.InputJsonValue;
}) {
  const issued = await issueSemaIdentifier('AUDIT', { action: input.action });
  return prisma.semaCoreAuditEntry.create({
    data: { id: issued.id, action: input.action, actorId: input.actorId ?? null, commandId: input.commandId ?? null, executionId: input.executionId ?? null, subjectIds: input.subjectIds ?? [], evidence: input.evidence ?? {} },
  });
}

export async function registerCoreCapability(input: {
  capabilityKey: string;
  displayName: string;
  description: string;
  providerKey: string;
  version: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const existing = await prisma.semaCoreCapability.findUnique({ where: { capabilityKey: input.capabilityKey }, select: { id: true } });
  if (existing) {
    return prisma.semaCoreCapability.update({
      where: { id: existing.id },
      data: { displayName: input.displayName, description: input.description, providerKey: input.providerKey, version: input.version, metadata: input.metadata ?? {}, status: 'ACTIVE' },
    });
  }
  const issued = await issueSemaIdentifier('CAPABILITY', { capabilityKey: input.capabilityKey });
  return prisma.semaCoreCapability.upsert({
    where: { capabilityKey: input.capabilityKey },
    create: { id: issued.id, ...input, metadata: input.metadata ?? {} },
    update: { displayName: input.displayName, description: input.description, providerKey: input.providerKey, version: input.version, metadata: input.metadata ?? {}, status: 'ACTIVE' },
  });
}

export async function discoverCoreCapabilities(query = '') {
  return prisma.semaCoreCapability.findMany({
    where: { status: 'ACTIVE', ...(query ? { OR: [{ capabilityKey: { contains: query, mode: 'insensitive' } }, { displayName: { contains: query, mode: 'insensitive' } }] } : {}) },
    orderBy: { displayName: 'asc' },
  });
}

/**
 * V1 local policy boundary. It deliberately returns a decision rather than
 * allowing applications to bypass Core. Organization/project policy providers
 * can replace this decision later without changing callers.
 */
export async function authorizeCoreInvocation(input: {
  actorId?: string | null;
  capabilityKey: string;
  workspaceId?: string | null;
}) {
  const capability = await prisma.semaCoreCapability.findUnique({
    where: { capabilityKey: input.capabilityKey },
    select: { id: true, status: true },
  });
  const allowed = Boolean(capability && capability.status === 'ACTIVE');
  const decision = {
    allowed,
    reason: allowed ? 'local-active-capability' : 'capability-unavailable',
    capabilityId: capability?.id ?? null,
  };
  await recordCoreAudit({
    action: 'policy.invocation.decision',
    actorId: input.actorId,
    subjectIds: capability?.id ? [capability.id] : [],
    evidence: { capabilityKey: input.capabilityKey, workspaceId: input.workspaceId ?? null, ...decision },
  });
  return decision;
}

/** Discovery identifies candidates; resolution returns the selected local provider. */
export async function resolveCoreCapability(input: {
  capabilityKey: string;
  actorId?: string | null;
  workspaceId?: string | null;
}) {
  const decision = await authorizeCoreInvocation(input);
  if (!decision.allowed || !decision.capabilityId) throw new Error(`Capability is unavailable: ${input.capabilityKey}`);
  const capability = await prisma.semaCoreCapability.findUniqueOrThrow({ where: { id: decision.capabilityId } });
  await recordCoreAudit({
    action: 'resolution.capability.selected',
    actorId: input.actorId,
    subjectIds: [capability.id],
    evidence: { capabilityKey: capability.capabilityKey, providerKey: capability.providerKey, workspaceId: input.workspaceId ?? null },
  });
  return capability;
}
