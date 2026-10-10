import type { Prisma } from '@prisma/client';
import { parseKeyId } from '@selo/sema-core';
import { callSemaCoreHost, consumeCoreIdentifier, reserveCoreIdentifiers, type CoreIdentifier } from '@/services/sema-core-host-client';

export type SemaIdentifierTypeCode = string;
export interface IssuedSemaIdentifier { id: string; installationId: string; localValue: bigint; localToken: string; typeCode?: string; }
const asIssued = (value: CoreIdentifier): IssuedSemaIdentifier => ({ id: value.id, installationId: value.installationId, localValue: value.localValue, localToken: value.localCode, typeCode: value.typeCode });

/** Shared SEMA Core issuance. VectorForge never writes the Core database. */
export async function issueSemaIdentifier(typeCode?: SemaIdentifierTypeCode, metadata: Prisma.InputJsonValue = {}): Promise<IssuedSemaIdentifier> { const { reservation, identifiers } = await reserveCoreIdentifiers(1, typeCode, metadata); return asIssued(await consumeCoreIdentifier(reservation.id, identifiers[0]!.id, metadata)); }
export async function reserveSemaIdentifiers(count: number, typeCode?: SemaIdentifierTypeCode, metadata: Prisma.InputJsonValue = {}) { return reserveCoreIdentifiers(count, typeCode, metadata); }
export async function consumeReservedSemaIdentifier(reservationId: string, id: string, metadata: Prisma.InputJsonValue = {}) { return asIssued(await consumeCoreIdentifier(reservationId, id, metadata)); }
export async function getSemaCoreIdentityState() { return callSemaCoreHost<{ status: string; installationId: string; version: string; capturedAt: string }>('/v1/core/health'); }
export async function inspectSemaIdentifier(id: string) { return { ...parseKeyId(id), issued: null }; }
