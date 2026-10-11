// One-time cleanup: marks old PENDING Core commands as CANCELLED.
// Older VectorForge versions created commands only to obtain an ID and never finished them.
//
//   Dry run (changes nothing):  npx tsx --env-file=.env src/scripts/cancel-stale-core-commands.ts
//   Apply:                      npx tsx --env-file=.env src/scripts/cancel-stale-core-commands.ts --apply
//   Optional:                   --older-than-hours=24   (default 24; newer commands are never touched)
import { callSemaCoreHost } from '../services/sema-core-host-client';
import { listCoreCommands, setCoreCommandStatus, recordCoreAudit } from '../services/sema-core';

const apply = process.argv.includes('--apply');
const hoursArg = process.argv.find((a) => a.startsWith('--older-than-hours='));
const hours = hoursArg ? Number(hoursArg.split('=')[1]) : 24;
if (!Number.isFinite(hours) || hours < 1) throw new Error('--older-than-hours must be at least 1');
const cutoff = Date.now() - hours * 3_600_000;
const BATCH = 250; // Core's maximum list size

async function pendingTotal() {
  const stats = await callSemaCoreHost<{ commands?: Record<string, number> }>('/v1/core/statistics');
  return stats.commands?.PENDING ?? 0;
}

async function main() {
  const total = await pendingTotal();
  console.log(`PENDING commands in Core: ${total}. Only those older than ${hours} h are eligible.`);
  if (!apply) {
    const sample = await listCoreCommands({ status: 'PENDING', limit: BATCH });
    const eligible = sample.filter((c) => Date.parse(c.createdAt) < cutoff);
    const byType: Record<string, number> = {};
    for (const c of eligible) byType[c.commandType] = (byType[c.commandType] ?? 0) + 1;
    console.log(`DRY RUN. First ${sample.length} listed, ${eligible.length} eligible. Nothing changed.`);
    console.log(JSON.stringify({ sampleByCommandType: byType, oldest: sample.map((c) => c.createdAt).sort()[0], newest: sample.map((c) => c.createdAt).sort().at(-1) }, null, 2));
    console.log('Run again with --apply to cancel all eligible commands.');
    return;
  }
  let cancelled = 0, failed = 0;
  const byType: Record<string, number> = {};
  for (;;) {
    const batch = await listCoreCommands({ status: 'PENDING', limit: BATCH });
    const eligible = batch.filter((c) => Date.parse(c.createdAt) < cutoff);
    if (eligible.length === 0) break;
    let progress = 0;
    for (const c of eligible) {
      try { await setCoreCommandStatus(c.id, 'CANCELLED'); cancelled++; progress++; byType[c.commandType] = (byType[c.commandType] ?? 0) + 1; }
      catch (e) { failed++; console.error(`Could not cancel ${c.id}: ${(e as Error).message}`); }
    }
    console.log(`Cancelled so far: ${cancelled}`);
    if (progress === 0) break; // nothing moved; avoid looping forever
  }
  await recordCoreAudit({ action: 'core.commands.abandoned-cleanup', evidence: { cancelled, failed, olderThanHours: hours, byType, reason: 'Commands created only as an ID source by older VectorForge versions and never finished.' } }).catch((e) => console.error('Audit entry not recorded:', (e as Error).message));
  console.log(JSON.stringify({ cancelled, failed, pendingNow: await pendingTotal() }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
