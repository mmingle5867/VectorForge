import { callSemaCoreHost } from '../services/sema-core-host-client';

async function main() {
  const [health, statistics] = await Promise.all([
    callSemaCoreHost<{ installationId: string; status: string; version: string }>('/v1/core/health'),
    callSemaCoreHost<{ nextLocalId: string; identifiers: { reserved: number; issued: number; reservations: number }; commands?: Record<string, number>; executions?: Record<string, number>; events?: number; auditEntries?: number }>('/v1/core/statistics'),
  ]);
  if (health.status !== 'ACTIVE') throw new Error('SEMA Core is not ACTIVE.');
  console.log(JSON.stringify({ ...health, nextLocalId: statistics.nextLocalId, issuedIdentifiers: statistics.identifiers.issued, reservedNotYetUsed: statistics.identifiers.reserved, reservationRecords: statistics.identifiers.reservations, commands: statistics.commands, executions: statistics.executions, events: statistics.events, auditEntries: statistics.auditEntries, status: 'verified' }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
