import type { Prisma } from '@prisma/client';

import config from '@/lib/config';
import prisma from '@/lib/prisma';
import {
  encodeBase56,
  formatSemaKeyId,
  normalizeTypeCode,
  parseSemaInstallationId,
  parseSemaKeyId,
} from '@/lib/sema-id';

const STATE_KEY = 'PRIMARY';

/** Classification only. It is never embedded in a canonical KeyID. */
export type SemaIdentifierTypeCode = string;

export interface IssuedSemaIdentifier {
  id: string;
  installationId: string;
  localValue: bigint;
  localToken: string;
  typeCode?: string;
}

type IdentityTransaction = Prisma.TransactionClient;

function configuredInstallationId() {
  return parseSemaInstallationId(config.sema.installationId);
}

export async function getSemaCoreIdentityState() {
  const installationId = configuredInstallationId();
  const state = await prisma.semaCoreIdentityState.upsert({
    where: { stateKey: STATE_KEY },
    update: {},
    create: { stateKey: STATE_KEY, installationId, nextLocalId: BigInt(1) },
  });
  if (state.installationId !== installationId) {
    throw new Error(
      `Configured SEMA InstallationID ${installationId} does not match initialized Core ${state.installationId}`
    );
  }
  if (state.status !== 'ACTIVE') throw new Error(`SEMA Core installation is ${state.status}`);
  return state;
}

/**
 * Issue one permanent KeyID from this installation's single shared sequence.
 * `typeCode` is retained only as optional display/audit classification metadata.
 */
export async function issueSemaIdentifier(
  typeCode?: SemaIdentifierTypeCode,
  metadata: Prisma.InputJsonValue = {}
): Promise<IssuedSemaIdentifier> {
  await getSemaCoreIdentityState();
  return prisma.$transaction((tx) => issueSemaIdentifierInTransaction(tx, typeCode, metadata));
}

export async function issueSemaIdentifierInTransaction(
  tx: IdentityTransaction,
  typeCode?: SemaIdentifierTypeCode,
  metadata: Prisma.InputJsonValue = {}
): Promise<IssuedSemaIdentifier> {
  const rows = await tx.$queryRaw<Array<{ installationId: string; localValue: bigint }>>`
    UPDATE "sema_core_identity_state"
    SET "nextLocalId" = "nextLocalId" + 1,
        "updatedAt" = NOW()
    WHERE "stateKey" = ${STATE_KEY}
      AND "status" = 'ACTIVE'
    RETURNING "installationId", "nextLocalId" - 1 AS "localValue"
  `;
  const issued = rows[0];
  if (!issued) throw new Error('SEMA Core KeyID allocator is unavailable');

  const id = formatSemaKeyId(issued);
  const localToken = encodeBase56(issued.localValue);
  const normalizedTypeCode = typeCode ? normalizeTypeCode(typeCode) : undefined;
  await tx.semaIssuedIdentifier.create({
    data: {
      semaId: id,
      installationId: issued.installationId,
      localValue: issued.localValue,
      localCode: localToken,
      typeCode: normalizedTypeCode,
      metadata,
    },
  });
  return { id, installationId: issued.installationId, localValue: issued.localValue, localToken, typeCode: normalizedTypeCode };
}

/** Allocate a child Core installation by consuming the parent's normal sequence. */
export async function issueChildInstallationId(metadata: Prisma.InputJsonValue = {}) {
  const issued = await issueSemaIdentifier('INSTALLATION', metadata);
  return issued.id;
}

export async function inspectSemaIdentifier(id: string) {
  const parts = parseSemaKeyId(id);
  return {
    ...parts,
    issued: await prisma.semaIssuedIdentifier.findUnique({ where: { semaId: id } }),
  };
}
