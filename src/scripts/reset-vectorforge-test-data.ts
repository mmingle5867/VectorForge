import { rm } from 'node:fs/promises';
import path from 'node:path';
import prisma from '../lib/prisma';

const confirmed = process.argv.includes('--confirm-reset-test-data');
const storageIndex = process.argv.indexOf('--storage-root');
const storageRoot = storageIndex >= 0 ? process.argv[storageIndex + 1] : './vectorforge-storage';

async function main() {
  if (!confirmed) throw new Error('Refusing reset. Re-run with --confirm-reset-test-data.');
  await prisma.$transaction(async (tx) => {
    await tx.relationshipCategory.deleteMany();
    await tx.relationshipMember.deleteMany();
    await tx.relationship.deleteMany();
    await tx.itemCategory.deleteMany();
    await tx.assetLocation.deleteMany();
    await tx.assetVersion.deleteMany();
    await tx.asset.deleteMany();
    await tx.assetProfile.deleteMany();
    await tx.artwork.deleteMany();
    await tx.item.deleteMany();
    await tx.category.deleteMany();
    await tx.batchItem.deleteMany();
    await tx.batch.deleteMany();
    await tx.dashboardPreference.deleteMany();
  });
  const artworkRoot = path.resolve(storageRoot, 'profiles');
  await rm(artworkRoot, { recursive: true, force: true });
  console.log('VectorForge test workflow reset. SEMA Core installation, Core ledger, users, profiles, workspaces, storage locations, and issued IDs were preserved.');
}

main().finally(() => prisma.$disconnect());
