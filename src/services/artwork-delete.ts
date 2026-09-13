import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

import { withArtworkMutationLock } from '@/lib/artwork-mutation-lock';
import { getManagedArtworkDirectory, remapPathWithinDirectory } from '@/lib/artwork-storage-paths';
import prisma from '@/lib/prisma';

function trashLeaf(directoryName: string, itemId: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${directoryName}-${stamp}-${itemId.slice(-6)}`;
}

export async function deleteArtwork(input: { userId: string; batchItemId: string }) {
  return withArtworkMutationLock(input.batchItemId, 'modified', async () => {
    const item = await prisma.batchItem.findFirst({
      where: { id: input.batchItemId, batch: { userId: input.userId } },
      include: {
        batch: true,
        semaItem: true,
        artwork: { include: { assetProfiles: true } },
        assets: {
          include: {
            relationshipMembers: { include: { relationship: true } },
            versions: { include: { locations: { include: { storageLocation: true } } } },
          },
        },
      },
    });
    if (!item?.uploadPath) throw new Error('Artwork working copy was not found');

    const affectedRelationships = new Set<string>();
    for (const asset of item.assets) {
      for (const membership of asset.relationshipMembers) {
        affectedRelationships.add(membership.relationship.id);
      }
    }

    const sourceDirectory = getManagedArtworkDirectory(item.uploadPath);
    if (!sourceDirectory) {
      throw new Error('Move this older artwork into a managed Storage Location before deleting it');
    }
    const profileBase = path.dirname(path.dirname(sourceDirectory));
    const trashRoot = path.join(profileBase, '.trash', 'artwork');
    const trashDirectory = path.join(trashRoot, trashLeaf(path.basename(sourceDirectory), item.id));
    await mkdir(trashRoot, { recursive: true });
    await rename(sourceDirectory, trashDirectory);

    const remap = (value: string | null) => remapPathWithinDirectory(value, sourceDirectory, trashDirectory);
    try {
      await prisma.$transaction(async (tx) => {
        for (const asset of item.assets) {
          await tx.relationshipMember.deleteMany({ where: { assetId: asset.id } });
          const nextFilePath = remap(asset.filePath);
          await tx.asset.update({ where: { id: asset.id }, data: { status: 'RETIRED', filePath: nextFilePath } });
          await tx.assetVersion.updateMany({ where: { assetId: asset.id }, data: { status: 'RETIRED' } });
          for (const version of asset.versions) {
            for (const location of version.locations) {
              const oldAbsolute = path.resolve(location.storageLocation.basePath, location.relativePath);
              const nextAbsolute = remap(oldAbsolute);
              if (nextAbsolute && nextAbsolute !== oldAbsolute) {
                await tx.assetLocation.update({
                  where: { id: location.id },
                  data: {
                    relativePath: path.relative(location.storageLocation.basePath, nextAbsolute).split(path.sep).join('/'),
                    status: 'ARCHIVED',
                    verifiedAt: new Date(),
                  },
                });
              }
            }
          }
        }
        if (item.itemId) {
          await tx.itemCategory.deleteMany({ where: { itemId: item.itemId } });
          await tx.item.update({ where: { id: item.itemId }, data: { status: 'RETIRED' } });
        }
        if (item.artworkId) {
          await tx.artwork.update({ where: { id: item.artworkId }, data: { status: 'RETIRED' } });
          await tx.assetProfile.updateMany({ where: { artworkId: item.artworkId }, data: { status: 'RETIRED' } });
        }
        await tx.issuedNumber.updateMany({
          where: {
            OR: [
              ...(item.itemId ? [{ itemId: item.itemId }] : []),
              ...(item.artworkId ? [{ artworkId: item.artworkId }] : []),
            ],
          },
          data: { status: 'RETIRED', notes: 'Artwork deleted from VectorForge dashboard' },
        });
        await tx.batchItem.delete({ where: { id: item.id } });
        await tx.batch.update({
          where: { id: item.batchId },
          data: {
            totalItems: Math.max(0, item.batch.totalItems - 1),
            completedItems: Math.max(0, item.batch.completedItems - (item.status === 'COMPLETED' ? 1 : 0)),
            failedItems: Math.max(0, item.batch.failedItems - (item.status === 'FAILED' ? 1 : 0)),
            currentItemId: item.batch.currentItemId === item.id ? null : item.batch.currentItemId,
          },
        });
        for (const relationshipId of affectedRelationships) {
          const remainingMembers = await tx.relationshipMember.count({ where: { relationshipId } });
          if (remainingMembers === 0) {
            await tx.relationship.update({ where: { id: relationshipId }, data: { status: 'RETIRED' } });
          }
        }
      });
    } catch (error) {
      await rename(trashDirectory, sourceDirectory).catch(() => undefined);
      throw error;
    }
    return { deleted: true, recoverableTrashPath: trashDirectory };
  });
}
