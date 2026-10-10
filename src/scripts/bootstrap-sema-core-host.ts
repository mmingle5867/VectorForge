import { callSemaCoreHost } from '../services/sema-core-host-client';

async function main() {
  const health = await callSemaCoreHost<{ installationId: string; status: string; version: string }>('/v1/core/health');
  if (health.status !== 'ACTIVE') throw new Error('SEMA Core is not ACTIVE.');
  console.log(`Shared SEMA Core ${health.installationId} is ready (v${health.version}).`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
