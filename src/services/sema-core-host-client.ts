import type { Prisma } from '@prisma/client';
import config from '@/lib/config';

export type CoreLifecycleStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'CANCELLED' | 'FAILED' | 'SUCCESS';
export type JsonObject = Record<string, Prisma.JsonValue>;
export interface CoreIdentifier { id: string; reservationId: string; installationId: string; localValue: bigint; localCode: string; typeCode?: string; status: 'RESERVED' | 'ISSUED'; metadata: JsonObject; }
export interface CoreCommand { id: string; commandType: string; actorId: string | null; workspaceId: string | null; subjectIds: string[]; context: JsonObject; payload: JsonObject; status: CoreLifecycleStatus; createdAt: string; }
export interface CoreExecution { id: string; commandId: string; providerId: string | null; status: CoreLifecycleStatus; startedAt: string | null; completedAt: string | null; context: JsonObject; error: JsonObject | null; }

function deserializeIdentifier(value: Omit<CoreIdentifier, 'localValue'> & { localValue: string | number | bigint }): CoreIdentifier { return { ...value, localValue: BigInt(value.localValue) }; }

export async function callSemaCoreHost<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; actorId?: string | null } = {}): Promise<T> {
  // The current loopback Host authorizes its local application transport.
  // Keep the VectorForge user in the command/audit body, but do not present it
  // as the Host administrator until per-application Core credentials exist.
  const response = await fetch(`${config.sema.hostUrl}${path}`, { method: init.method ?? 'GET', headers: { accept: 'application/json', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) }, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: 'no-store' });
  const payload = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) { const message = payload && typeof payload === 'object' && 'error' in payload ? payload.error?.message : undefined; throw new Error(message || `SEMA Core request failed (${response.status})`); }
  return payload as T;
}

export async function reserveCoreIdentifiers(count: number, typeCode?: string, metadata: Prisma.InputJsonValue = {}) {
  const response = await callSemaCoreHost<{ reservation: { id: string; installationId: string; firstLocalValue: string | number | bigint; count: number; typeCode?: string; metadata: JsonObject; createdAt: string }; identifiers: Array<Omit<CoreIdentifier, 'localValue'> & { localValue: string | number | bigint }> }>('/v1/core/identifiers/reservations', { method: 'POST', body: { count, typeCode, metadata } });
  return { ...response, reservation: { ...response.reservation, firstLocalValue: BigInt(response.reservation.firstLocalValue) }, identifiers: response.identifiers.map(deserializeIdentifier) };
}
export async function consumeCoreIdentifier(reservationId: string, id: string, metadata: Prisma.InputJsonValue = {}) { return deserializeIdentifier(await callSemaCoreHost<Omit<CoreIdentifier, 'localValue'> & { localValue: string | number | bigint }>('/v1/core/identifiers/consume', { method: 'POST', body: { reservationId, id, metadata } })); }
