import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import config from '@/lib/config';
import { ensureArtworkIdentityForBatchItem } from '@/services/numbering-service';

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

function makeOwnerObjectId(userId: string) {
  return `OWNER-${userId}`;
}

function makeWorkspaceObjectId() {
  return 'WORKSPACE-DEFAULT';
}

function makeItemObjectId(batchItemId: string) {
  return `ITEM-${batchItemId}`;
}

function makeAssetObjectId(batchItemId: string, role: string) {
  const safeRole = role
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `ASSET-${batchItemId}-${safeRole || 'FILE'}`;
}

export async function ensureOwnerAndWorkspace(userId: string) {
  const owner = await prisma.owner.upsert({
    where: { userId },
    update: {
      name: config.localFirst.localOwnerName,
    },
    create: {
      userId,
      ownerId: makeOwnerObjectId(userId),
      name: config.localFirst.localOwnerName,
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: {
      ownerId_workspaceId: {
        ownerId: owner.id,
        workspaceId: makeWorkspaceObjectId(),
      },
    },
    update: {
      name: config.localFirst.localWorkspaceName,
    },
    create: {
      ownerId: owner.id,
      workspaceId: makeWorkspaceObjectId(),
      name: config.localFirst.localWorkspaceName,
    },
  });

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

  const semaItem = await prisma.item.upsert({
    where: {
      ownerId_itemId: {
        ownerId: owner.id,
        itemId: makeItemObjectId(input.batchItemId),
      },
    },
    update: {
      title: input.title,
      workspaceId: workspace.id,
    },
    create: {
      ownerId: owner.id,
      workspaceId: workspace.id,
      itemId: makeItemObjectId(input.batchItemId),
      title: input.title,
    },
  });

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

  const assetId = makeAssetObjectId(input.batchItemId, input.role);

  return prisma.asset.upsert({
    where: {
      ownerId_assetId: {
        ownerId: batchItem.owner.id,
        assetId,
      },
    },
    update: {
      workspaceId: batchItem.workspace.id,
      itemId: batchItem.semaItem.id,
      artworkId: batchItem.artwork.id,
      filePath: input.filePath ?? null,
      mimeType: input.mimeType ?? null,
      metadata: input.metadata ?? {},
    },
    create: {
      ownerId: batchItem.owner.id,
      workspaceId: batchItem.workspace.id,
      itemId: batchItem.semaItem.id,
      artworkId: batchItem.artwork.id,
      batchItemId: batchItem.id,
      assetId,
      role: input.role,
      filePath: input.filePath ?? null,
      mimeType: input.mimeType ?? null,
      metadata: input.metadata ?? {},
    },
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
