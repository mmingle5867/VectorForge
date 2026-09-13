/**
 * One-time controlled conversion from provisional VectorForge row IDs to final
 * Core-issued SEMA KeyIDs. It intentionally creates no runtime alias table.
 *
 * Usage:
 *   node --import tsx src/scripts/renumber-sema-core.ts --dry-run
 *   node --import tsx src/scripts/renumber-sema-core.ts --apply --backup-confirmed C:\\path\\backup.ok
 */
import { access, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';

import prisma from '../lib/prisma';
import { encodeBase56, parseSemaKeyId } from '../lib/sema-id';

type ObjectTable = { table: string; typeCode: string; identityColumn?: string; jsonColumns?: string[] };

const OBJECT_TABLES: ObjectTable[] = [
  { table: 'users', typeCode: 'USER' },
  { table: 'user_settings', typeCode: 'SETTINGS', jsonColumns: ['defaultSubstitutions'] },
  { table: 'batches', typeCode: 'BATCH', jsonColumns: ['substitutionData'] },
  { table: 'batch_items', typeCode: 'BATCH_ITEM' },
  { table: 'number_sequences', typeCode: 'NUMBER_SEQUENCE' },
  { table: 'issued_numbers', typeCode: 'ISSUED_NUMBER' },
  { table: 'owners', typeCode: 'OWNER', identityColumn: 'ownerId' },
  { table: 'workspaces', typeCode: 'WORKSPACE', identityColumn: 'workspaceId' },
  { table: 'items', typeCode: 'ITEM', identityColumn: 'itemId' },
  { table: 'artworks', typeCode: 'ARTWORK', identityColumn: 'artworkNumber' },
  { table: 'asset_profiles', typeCode: 'ASSET_PROFILE', identityColumn: 'profileNumber' },
  { table: 'product_variants', typeCode: 'PRODUCT_VARIANT' },
  { table: 'assets', typeCode: 'ASSET', identityColumn: 'assetId', jsonColumns: ['metadata'] },
  { table: 'asset_versions', typeCode: 'ASSET_VERSION', identityColumn: 'assetVersionId', jsonColumns: ['metadata'] },
  { table: 'storage_locations', typeCode: 'STORAGE_LOCATION', identityColumn: 'locationId', jsonColumns: ['metadata'] },
  { table: 'asset_locations', typeCode: 'ASSET_LOCATION' },
  { table: 'sema_profiles', typeCode: 'PROFILE', identityColumn: 'profileId', jsonColumns: ['metadata'] },
  { table: 'categories', typeCode: 'CATEGORY', identityColumn: 'categoryId', jsonColumns: ['metadata'] },
  { table: 'item_categories', typeCode: 'ITEM_CATEGORY' },
  { table: 'relationships', typeCode: 'RELATIONSHIP', identityColumn: 'relationshipId', jsonColumns: ['metadata'] },
  { table: 'relationship_members', typeCode: 'RELATIONSHIP_MEMBER', jsonColumns: ['metadata'] },
  { table: 'relationship_categories', typeCode: 'RELATIONSHIP_CATEGORY' },
  { table: 'documents', typeCode: 'DOCUMENT', identityColumn: 'documentId', jsonColumns: ['metadata'] },
  { table: 'dashboard_preferences', typeCode: 'DASHBOARD_PREFERENCE', jsonColumns: ['expandedCategoryIds', 'selectedCategoryIds', 'filters', 'sorting'] },
];

// These legacy columns carry object references but predate foreign-key
// constraints. They must be rewritten once, not interpreted at runtime.
const LOOSE_REFERENCE_COLUMNS = [
  { table: 'batches', column: 'currentItemId' },
  { table: 'issued_numbers', column: 'itemId' },
  { table: 'issued_numbers', column: 'batchId' },
  { table: 'issued_numbers', column: 'artworkId' },
  { table: 'issued_numbers', column: 'assetProfileId' },
  { table: 'artworks', column: 'sourceItemId' },
  { table: 'categories', column: 'scopeId' },
] as const;

type IdMap = Map<string, string>;
type DatabaseClient = typeof prisma | Prisma.TransactionClient;

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string) {
  return process.argv.includes(name);
}

function replacement(value: unknown, map: IdMap): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => replacement(entry, map));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, replacement(entry, map)]));
  }
  return value;
}

async function readObjects(database: DatabaseClient, table: string) {
  const timestampColumn = await database.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = 'createdAt'
    ) AS exists`,
    table
  );
  const orderBy = timestampColumn[0]?.exists
    ? '"createdAt" ASC NULLS FIRST, "id" ASC'
    : '"id" ASC';
  const createdAt = timestampColumn[0]?.exists ? '"createdAt"' : 'NULL::timestamp';
  return database.$queryRawUnsafe<Array<{ id: string; createdAt: Date | null }>>(
    `SELECT "id", ${createdAt} AS "createdAt" FROM "${table}" ORDER BY ${orderBy}`
  );
}

async function buildPlan() {
  const state = await prisma.semaCoreIdentityState.findUnique({ where: { stateKey: 'PRIMARY' } });
  if (!state) throw new Error('SEMA Core is not initialized. Apply the final Core Prisma migration first.');
  if (state.installationId !== '3') throw new Error(`This migration is only authorized for initial installation 3, found ${state.installationId}.`);
  if (state.nextLocalId !== BigInt(1) || await prisma.semaIssuedIdentifier.count()) {
    throw new Error('Core allocator is not empty. Renumbering must be the first permanent issuance in this installation.');
  }

  let localValue = BigInt(1);
  const map = new Map<string, string>();
  const entries: Array<{ table: ObjectTable; oldId: string; newId: string }> = [];
  for (const table of OBJECT_TABLES) {
    for (const row of await readObjects(prisma, table.table)) {
      const newId = `3-${encodeBase56(localValue++)}`;
      if (map.has(row.id)) throw new Error(`Duplicate provisional ID found: ${row.id}`);
      map.set(row.id, newId);
      entries.push({ table, oldId: row.id, newId });
    }
  }
  return { map, entries, nextLocalId: localValue };
}

async function rewriteJsonColumns(database: DatabaseClient, map: IdMap) {
  for (const table of OBJECT_TABLES) {
    for (const column of table.jsonColumns ?? []) {
      const rows = await database.$queryRawUnsafe<Array<{ id: string; value: unknown }>>(
        `SELECT "id", "${column}" AS value FROM "${table.table}"`
      );
      for (const row of rows) {
        const next = replacement(row.value, map);
        if (JSON.stringify(next) !== JSON.stringify(row.value)) {
          await database.$executeRawUnsafe(
            `UPDATE "${table.table}" SET "${column}" = $1::jsonb WHERE "id" = $2`,
            JSON.stringify(next),
            row.id
          );
        }
      }
    }
  }
}

async function preflightJsonColumns(database: DatabaseClient) {
  for (const table of OBJECT_TABLES) {
    for (const column of table.jsonColumns ?? []) {
      await database.$queryRawUnsafe(
        `SELECT "id", "${column}" FROM "${table.table}" LIMIT 1`
      );
    }
  }
}

async function rewriteLooseReferenceColumns(database: DatabaseClient, map: IdMap) {
  for (const reference of LOOSE_REFERENCE_COLUMNS) {
    for (const [oldId, newId] of map) {
      await database.$executeRawUnsafe(
        `UPDATE "${reference.table}" SET "${reference.column}" = $1 WHERE "${reference.column}" = $2`,
        newId,
        oldId
      );
    }
  }
}

async function rewriteManifestFile(filePath: string, map: IdMap) {
  const original = await readFile(filePath, 'utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(original); } catch { return false; }
  const next = replacement(parsed, map);
  if (JSON.stringify(next) === JSON.stringify(parsed)) return false;
  const tempPath = `${filePath}.sema-renumber.tmp`;
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
  return true;
}

async function rewriteManagedManifests(root: string, map: IdMap): Promise<number> {
  let changed = 0;
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile() && entry.name.endsWith('.json')) changed += Number(await rewriteManifestFile(next, map));
    }
  }
  try { await visit(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  return changed;
}

async function verifyPlan(entries: Array<{ newId: string }>, nextLocalId: bigint) {
  const count = await prisma.semaIssuedIdentifier.count();
  if (count !== entries.length) throw new Error(`Issued identity count mismatch: expected ${entries.length}, found ${count}`);
  for (const entry of entries) parseSemaKeyId(entry.newId);
  const state = await prisma.semaCoreIdentityState.findUniqueOrThrow({ where: { stateKey: 'PRIMARY' } });
  if (state.nextLocalId !== nextLocalId) throw new Error('Core counter does not match renumbering plan.');
}

async function applyPlan(plan: Awaited<ReturnType<typeof buildPlan>>, storageRoot: string) {
  // Every database reference change is inside this transaction. If a JSON or
  // loose-reference update fails, no primary ID change is committed.
  await preflightJsonColumns(prisma);
  await prisma.$transaction(async (tx) => {
    for (const entry of plan.entries) {
      const localValue = parseSemaKeyId(entry.newId).localValue;
      await tx.semaIssuedIdentifier.create({
        data: {
          semaId: entry.newId,
          installationId: '3',
          localValue,
          localCode: encodeBase56(localValue),
          typeCode: entry.table.typeCode,
          // Retaining the old value solely in the one-time issuance audit makes
          // --resume deterministic if a later filesystem manifest write stops.
          metadata: { migration: 'vectorforge-final-core-renumber', sourceTable: entry.table.table, legacyId: entry.oldId },
        },
      });
    }
    for (const entry of plan.entries) {
      await tx.$executeRawUnsafe(`UPDATE "${entry.table.table}" SET "id" = $1 WHERE "id" = $2`, entry.newId, entry.oldId);
    }
    for (const table of OBJECT_TABLES) {
      if (table.identityColumn) {
        await tx.$executeRawUnsafe(`UPDATE "${table.table}" SET "${table.identityColumn}" = "id"`);
      }
    }
    await rewriteJsonColumns(tx, plan.map);
    await rewriteLooseReferenceColumns(tx, plan.map);
    await tx.semaCoreIdentityState.update({ where: { stateKey: 'PRIMARY' }, data: { nextLocalId: plan.nextLocalId } });
  }, { timeout: 120_000 });

  const manifests = await rewriteManagedManifests(storageRoot, plan.map);
  await verifyPlan(plan.entries, plan.nextLocalId);
  return manifests;
}

async function buildResumeMap() {
  const issued = await prisma.semaIssuedIdentifier.findMany({
    where: { installationId: '3' },
    select: { semaId: true, metadata: true },
    orderBy: { localValue: 'asc' },
  });
  if (!issued.length) throw new Error('No final Core renumber issuance ledger exists to resume.');

  const map = new Map<string, string>();
  for (const entry of issued) {
    const legacyId = entry.metadata && typeof entry.metadata === 'object'
      ? (entry.metadata as Record<string, unknown>).legacyId
      : undefined;
    if (typeof legacyId !== 'string' || !legacyId) {
      throw new Error(`Cannot resume: issuance ${entry.semaId} has no recorded legacyId. Restore the pre-renumber database backup instead.`);
    }
    map.set(legacyId, entry.semaId);
  }
  return map;
}

async function resumePlan(storageRoot: string) {
  const map = await buildResumeMap();
  await preflightJsonColumns(prisma);
  await prisma.$transaction(async (tx) => {
    await rewriteJsonColumns(tx, map);
    await rewriteLooseReferenceColumns(tx, map);
  }, { timeout: 120_000 });
  const manifests = await rewriteManagedManifests(storageRoot, map);
  console.log(`Renumbering reference repair completed. Rewrote ${manifests} managed JSON manifests.`);
}

async function main() {
  const apply = has('--apply');
  const resume = has('--resume');
  const dryRun = has('--dry-run') || !apply;
  if (resume && (apply || has('--dry-run'))) throw new Error('--resume cannot be combined with --apply or --dry-run.');
  if (apply && dryRun) throw new Error('Choose either --dry-run or --apply.');

  const marker = arg('--backup-confirmed');
  const storageRoot = arg('--storage-root') ?? process.env.VECTORFORGE_STORAGE_ROOT ?? './vectorforge-storage';
  if (resume) {
    if (!marker) throw new Error('--resume requires --backup-confirmed <verified backup marker file>.');
    await access(marker);
    await resumePlan(storageRoot);
    return;
  }

  const plan = await buildPlan();
  const summary = Object.fromEntries(OBJECT_TABLES.map((table) => [table.table, plan.entries.filter((entry) => entry.table.table === table.table).length]));
  console.log(JSON.stringify({ installationId: '3', objectCount: plan.entries.length, nextLocalId: encodeBase56(plan.nextLocalId), byTable: summary, sample: plan.entries.slice(0, 12).map(({ table, oldId, newId }) => ({ table: table.table, oldId, newId })) }, null, 2));
  if (dryRun) return;

  if (!marker) throw new Error('--apply requires --backup-confirmed <verified backup marker file>.');
  await access(marker);
  const manifests = await applyPlan(plan, storageRoot);
  console.log(`Renumbering completed. Rewrote ${manifests} managed JSON manifests. No runtime legacy-ID map was created.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
