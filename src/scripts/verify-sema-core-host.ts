import { parseKeyId } from '@selo/sema-core';
import prisma from '../lib/prisma';

async function main() {
  const [state, settings, issued, missingReservations, invalid] = await Promise.all([
    prisma.semaCoreIdentityState.findUniqueOrThrow({ where: { stateKey: 'PRIMARY' } }),
    prisma.semaCoreHostSettings.findUniqueOrThrow({ where: { settingsKey: 'PRIMARY' } }),
    prisma.semaIssuedIdentifier.findMany({ select: { semaId: true, installationId: true } }),
    prisma.semaIssuedIdentifier.count({ where: { reservationId: null } }),
    prisma.semaIssuedIdentifier.count({ where: { status: { notIn: ['ISSUED', 'RESERVED'] } } }),
  ]);
  if (state.status !== 'ACTIVE') throw new Error('SEMA Core identity state is not ACTIVE.');
  if (settings.installationId !== state.installationId) throw new Error('SEMA Core Host settings do not match the active installation.');
  if (missingReservations) throw new Error(`${missingReservations} issued identifier(s) have no Core reservation.`);
  if (invalid) throw new Error(`${invalid} issued identifier(s) have an invalid lifecycle status.`);
  for (const identifier of issued) {
    if (parseKeyId(identifier.semaId).installationId !== identifier.installationId) throw new Error(`Installation mismatch for ${identifier.semaId}.`);
  }
  const reservations = await prisma.semaIdentifierReservation.count();
  console.log(JSON.stringify({ installationId: state.installationId, nextLocalId: state.nextLocalId.toString(), issuedIdentifiers: issued.length, reservations, settingsRevision: settings.revision, status: 'verified' }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
