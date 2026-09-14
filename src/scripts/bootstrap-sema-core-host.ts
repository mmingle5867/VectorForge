import prisma from '../lib/prisma';

async function main() {
  await prisma.$transaction(async (tx) => {
    const state = await tx.semaCoreIdentityState.findUniqueOrThrow({ where: { stateKey: 'PRIMARY' } });
    const settings = await tx.semaCoreHostSettings.upsert({ where: { settingsKey: 'PRIMARY' }, update: {}, create: { settingsKey: 'PRIMARY', installationId: state.installationId } });
    const existing = await tx.semaIssuedIdentifier.count({ where: { reservationId: null } });
    if (!existing) return console.log(`SEMA Core Host ready at settings revision ${settings.revision}; historical ledger already backfilled.`);
    const oldest = await tx.semaIssuedIdentifier.findFirst({ where: { reservationId: null }, orderBy: { localValue: 'asc' }, select: { semaId: true, installationId: true, localValue: true } });
    if (!oldest) throw new Error('Historical SEMA ledger backfill has no issued identifier.');
    const reservationId = oldest.semaId;
    await tx.semaIdentifierReservation.create({ data: { id: reservationId, installationId: oldest.installationId, firstLocalValue: oldest.localValue, count: existing, typeCode: 'HISTORICAL', metadata: { purpose: 'pre-reservation-ledger-backfill' } } });
    await tx.semaIssuedIdentifier.updateMany({ where: { reservationId: null }, data: { reservationId, status: 'ISSUED', consumedAt: new Date() } });
    console.log(`SEMA Core Host initialized. Backfilled ${existing} existing IDs into historical reservation ${reservationId}.`);
  });
}
main().finally(() => prisma.$disconnect());
