import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import config from '@/lib/config';
import { ensureArtworkIdentityForBatchItem } from '@/services/numbering-service';
import { issueSemaIdentifier } from '@/services/sema-core-identity';

type EnsureBatchItemSemaContextInput = {
  userId: string;
  batchId: string;
  batchItemId: string;
  title: string;
  sourceFilePath?: string | null;
  sourceMimeType?: string | null;
};

type GeneratedAssetInput = {
  batchItemId: string;
  role: string;
  filePath?: string | null;
  mimeType?: string | null;
  metadata?: Prisma.InputJsonObject;
};

type GeneratedAssetForBatchItemInput = Omit<GeneratedAssetInput, 'batchItemId'>;

export async function ensureOwnerAndWorkspace(userId: string) {
  let owner = await prisma.owner.findUnique({ where: { userId } });
  if (!owner) {
    const ownerIdentifier = await issueSemaIdentifier('OWN', { purpose: 'owner' });
    owner = await prisma.owner.create({
      data: {
        userId,
        ownerId: ownerIdentifier.id,
        name: config.localFirst.localOwnerName,
      },
    });
  } else if (owner.name !== config.localFirst.localOwnerName) {
    owner = await prisma.owner.update({
      where: { id: owner.id },
      data: { name: config.localFirst.localOwnerName },
    });
  }

  let workspace = await prisma.workspace.findFirst({
    where: { ownerId: owner.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!workspace) {
    const workspaceIdentifier = await issueSemaIdentifier('WSP', { purpose: 'default-workspace' });
    workspace = await prisma.workspace.create({
      data: {
        ownerId: owner.id,
        workspaceId: workspaceIdentifier.id,
        name: config.localFirst.localWorkspaceName,
      },
    });
  } else if (workspace.name !== config.localFirst.localWorkspaceName) {
    workspace = await prisma.workspace.update({
      where: { id: workspace.id },
      data: { name: config.localFirst.localWorkspaceName },
    });
  }

  return { owner, workspace };
}

export async function ensureBatchItemSemaContext(input: EnsureBatchItemSemaContextInput) {
  const { owner, workspace } = await ensureOwnerAndWorkspace(input.userId);

  await prisma.batch.update({
    where: { id: input.batchId },
    data: {
      ownerId: owner.id,
      workspaceId: workspace.id,
    },
  });

  const batchItem = await prisma.batchItem.findUnique({
    where: { id: input.batchItemId },
    include: { semaItem: true },
  });
  if (!batchItem || batchItem.batchId !== input.batchId) {
    throw new Error('Batch item not found for SEMA context');
  }

  let semaItem = batchItem.semaItem;
  if (!semaItem) {
    const itemIdentifier = await issueSemaIdentifier('ITM', {
      purpose: 'item',
      batchItemRowKey: input.batchItemId,
    });
    semaItem = await prisma.item.create({
      data: {
        ownerId: owner.id,
        workspaceId: workspace.id,
        itemId: itemIdentifier.id,
        title: input.title,
      },
    });
  } else {
    semaItem = await prisma.item.update({
      where: { id: semaItem.id },
      data: { title: input.title, workspaceId: workspace.id },
    });
  }

  await prisma.batchItem.update({
    where: { id: input.batchItemId },
    data: {
      ownerId: owner.id,
      workspaceId: workspace.id,
      itemId: semaItem.id,
    },
  });

  const artworkIdentity = await ensureArtworkIdentityForBatchItem({
    itemId: input.batchItemId,
    batchId: input.batchId,
    userId: input.userId,
    title: input.title,
    ownerId: owner.id,
    workspaceId: workspace.id,
    semaItemId: semaItem.id,
  });

  const sourceAsset = await upsertAssetForBatchItem({
    batchItemId: input.batchItemId,
    role: 'source-file',
    filePath: input.sourceFilePath,
    mimeType: input.sourceMimeType,
    metadata: {
      sourceApp: config.identity.sourceId,
      sourceSystem: config.identity.slug,
      itemId: semaItem.itemId,
      artworkId: artworkIdentity.artworkNumber,
    },
  });

  return {
    owner,
    workspace,
    item: semaItem,
    artwork: artworkIdentity,
    sourceAsset,
  };
}

export async function upsertAssetForBatchItem(input: GeneratedAssetInput) {
  const batchItem = await prisma.batchItem.findUnique({
    where: { id: input.batchItemId },
    include: {
      owner: true,
      workspace: true,
      semaItem: true,
      artwork: true,
    },
  });

  if (!batchItem?.owner || !batchItem.workspace || !batchItem.semaItem || !batchItem.artwork) {
    throw new Error('Batch item is missing SEMA context for asset creation');
  }

  const existing = await prisma.asset.findFirst({
    where: { batchItemId: batchItem.id, role: input.role },
  });
  if (existing) {
    return prisma.asset.update({
      where: { id: existing.id },
      data: {
      workspaceId: batchItem.workspace.id,
      itemId: batchItem.semaItem.id,
      artworkId: batchItem.artwork.id,
      filePath: input.filePath ?? null,
      mimeType: input.mimeType ?? null,
      metadata: input.metadata ?? {},
    },
    });
  }

  const assetIdentifier = await issueSemaIdentifier('AST', {
    purpose: 'asset',
    role: input.role,
    batchItemRowKey: input.batchItemId,
  });
  return prisma.asset.create({
    data: {
      ownerId: batchItem.owner.id,
      workspaceId: batchItem.workspace.id,
      itemId: batchItem.semaItem.id,
      artworkId: batchItem.artwork.id,
      batchItemId: batchItem.id,
      assetId: assetIdentifier.id,
      role: input.role,
      filePath: input.filePath ?? null,
      mimeType: input.mimeType ?? null,
      metadata: input.metadata ?? {},
    },
  });
}

/**
 * Creates the permanent Foundation context for a newly imported artwork.
 * This is the artwork-first replacement for the legacy Batch/BatchItem bridge:
 * each import receives its own Item, Artwork, immutable original Asset, and
 * mutable working-raster Asset without creating a workflow wrapper record.
 */
export async function createArtworkSemaContext(input: {
  userId: string;
  title: string;
  originalFilePath: string;
  workingFilePath: string;
  mimeType?: string | null;
}) {
  const { owner, workspace } = await ensureOwnerAndWorkspace(input.userId);
  const [itemIdentifier, artworkIdentifier, originalAssetIdentifier, workingAssetIdentifier] = await Promise.all([
    issueSemaIdentifier('ITM', { purpose: 'artwork-item', title: input.title }),
    issueSemaIdentifier('ART', { purpose: 'artwork', title: input.title }),
    issueSemaIdentifier('AST', { purpose: 'original-raster' }),
    issueSemaIdentifier('AST', { purpose: 'working-raster' }),
  ]);

  return prisma.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: {
        id: itemIdentifier.id,
        itemId: itemIdentifier.id,
        ownerId: owner.id,
        workspaceId: workspace.id,
        title: input.title,
      },
    });
    const artwork = await tx.artwork.create({
      data: {
        id: artworkIdentifier.id,
        artworkNumber: artworkIdentifier.id,
        numericSequence: 0,
        userId: input.userId,
        ownerId: owner.id,
        workspaceId: workspace.id,
        itemId: item.id,
        title: input.title,
        outputBaseName: input.title,
      },
    });
    const common = {
      ownerId: owner.id,
      workspaceId: workspace.id,
      itemId: item.id,
      artworkId: artwork.id,
      mimeType: input.mimeType ?? null,
    };
    const originalAsset = await tx.asset.create({
      data: {
        id: originalAssetIdentifier.id,
        assetId: originalAssetIdentifier.id,
        ...common,
        role: 'original-file',
        filePath: input.originalFilePath,
        metadata: { immutableSource: true },
      },
    });
    const workingAsset = await tx.asset.create({
      data: {
        id: workingAssetIdentifier.id,
        assetId: workingAssetIdentifier.id,
        ...common,
        role: 'source-file',
        filePath: input.workingFilePath,
        metadata: { currentWorkingRaster: true, derivedFromAssetId: originalAsset.assetId },
      },
    });
    return { owner, workspace, item, artwork, originalAsset, workingAsset };
  });
}

export async function upsertGeneratedAssetsForBatchItem(
  batchItemId: string,
  assets: GeneratedAssetForBatchItemInput[]
) {
  const results = [];
  for (const asset of assets) {
    results.push(
      await upsertAssetForBatchItem({
        ...asset,
        batchItemId,
      })
    );
  }
  return results;
}
