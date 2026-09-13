import { access, cp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import prisma from '@/lib/prisma';
import { semaLocalToken } from '@/lib/sema-id';
import { withArtworkMutationLock } from '@/lib/artwork-mutation-lock';
import { getManagedArtworkDirectory, remapPathWithinDirectory } from '@/lib/artwork-storage-paths';
import { createCoreCommand } from '@/services/sema-core';
import { reserveAvailableDirectoryName } from '@/services/artwork-ingest';

const PATH_FIELDS = [
  'uploadPath', 'upscaledPath', 'svgPath', 'aiPath', 'dxfPath', 'epsPath',
  'previewPath', 'outputFolderPath', 'zipPath', 'skuFilePath', 'metadataPath',
] as const;

function safeBaseName(value: string) {
  const result = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
  if (!result || result === '.' || result === '..') throw new Error('Enter a valid filename');
  return result;
}

async function exists(filePath: string) {
  try { await access(filePath); return true; } catch { return false; }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(filePath) : [filePath];
  }));
  return nested.flat();
}

function renamedLeaf(name: string, oldStems: string[], newBaseName: string) {
  const parsed = path.parse(name);
  const oldStem = oldStems.find((stem) =>
    parsed.name.toLocaleLowerCase() === stem.toLocaleLowerCase() ||
    parsed.name.toLocaleLowerCase().startsWith(`${stem.toLocaleLowerCase()}-`) ||
    parsed.name.toLocaleLowerCase().startsWith(`${stem.toLocaleLowerCase()}_`)
  );
  if (!oldStem) return name;
  return `${newBaseName}${parsed.name.slice(oldStem.length)}${parsed.ext}`;
}

async function renameArtworkUnlocked(input: {
  userId: string;
  batchItemId: string;
  newBaseName: string;
}) {
  const newBaseName = safeBaseName(input.newBaseName);
  const item = await prisma.batchItem.findFirst({
    where: { id: input.batchItemId, batch: { userId: input.userId } },
    include: {
      semaItem: true,
      artwork: true,
      assets: { include: { versions: { include: { locations: { include: { storageLocation: true } } } } } },
    },
  });
  if (!item?.uploadPath) throw new Error('Artwork working copy was not found');

  const oldDirectory = getManagedArtworkDirectory(item.uploadPath);
  if (!oldDirectory) {
    throw new Error('This older artwork must be moved into a managed Storage Location before it can be renamed');
  }
  const oldDirectoryName = path.basename(oldDirectory);
  const oldFileStem = path.parse(item.originalFilename).name;
  if (newBaseName.toLocaleLowerCase() === oldDirectoryName.toLocaleLowerCase()) {
    return { item, changed: false };
  }

  const profile = await prisma.semaProfile.findFirst({
    where: { userId: input.userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!profile) throw new Error('Active SEMA profile was not found for filename allocation');
  const allocatedBaseName = await reserveAvailableDirectoryName(
    profile.id,
    newBaseName,
    path.dirname(oldDirectory)
  );
  const targetDirectory = path.join(path.dirname(oldDirectory), allocatedBaseName);

  const renameOperation = await createCoreCommand({
    commandType: 'vectorforge.artwork.rename',
    actorId: input.userId,
    subjectIds: [item.id, item.semaItem?.id, item.artwork?.id].filter(Boolean) as string[],
    payload: { requestedBaseName: newBaseName, allocatedBaseName },
  });
  const stagedDirectory = path.join(path.dirname(oldDirectory), `.rename-${semaLocalToken(renameOperation.id)}`);
  const relativeRenames = new Map<string, string>();
  await cp(oldDirectory, stagedDirectory, { recursive: true, errorOnExist: true, force: false });
  try {
    const files = await listFiles(stagedDirectory);
    for (const filePath of files) {
      const nextName = renamedLeaf(path.basename(filePath), [oldFileStem, oldDirectoryName, item.baseName], allocatedBaseName);
      if (nextName === path.basename(filePath)) continue;
      const nextPath = path.join(path.dirname(filePath), nextName);
      if (await exists(nextPath)) throw new Error(`Rename would overwrite ${nextName}`);
      const oldRelative = path.relative(stagedDirectory, filePath);
      await rename(filePath, nextPath);
      relativeRenames.set(oldRelative, path.relative(stagedDirectory, nextPath));
    }
    await rename(stagedDirectory, targetDirectory);
  } catch (error) {
    await rm(stagedDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  const remapAbsolutePath = (value: string | null) => {
    return remapPathWithinDirectory(value, oldDirectory, targetDirectory, relativeRenames);
  };

  const newOriginalFilename = `${allocatedBaseName}${path.extname(item.originalFilename).toLowerCase()}`;
  const updateData: Record<string, string | null> = {};
  for (const field of PATH_FIELDS) updateData[field] = remapAbsolutePath(item[field]);

  try {
    for (const jsonPath of (await listFiles(targetDirectory)).filter((filePath) => path.extname(filePath).toLowerCase() === '.json')) {
      try {
        const current = await readFile(jsonPath, 'utf8');
        const updated = current
          .split(oldDirectory).join(targetDirectory)
          .split(item.originalFilename).join(newOriginalFilename)
          .split(oldDirectoryName).join(allocatedBaseName);
        if (updated !== current) await writeFile(jsonPath, updated, 'utf8');
      } catch {
        // A malformed optional JSON file does not prevent the database-authoritative rename.
      }
    }
  } catch {
    // A directory without readable optional manifests can still be renamed safely.
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.batchItem.update({
        where: { id: item.id },
        data: { ...updateData, baseName: allocatedBaseName, originalFilename: newOriginalFilename },
      });
      if (item.semaItem) await tx.item.update({ where: { id: item.semaItem.id }, data: { title: allocatedBaseName } });
      if (item.artwork) await tx.artwork.update({ where: { id: item.artwork.id }, data: { title: allocatedBaseName } });

      for (const asset of item.assets) {
        const nextFilePath = remapAbsolutePath(asset.filePath);
        if (nextFilePath !== asset.filePath) {
          await tx.asset.update({ where: { id: asset.id }, data: { filePath: nextFilePath } });
        }
        for (const version of asset.versions) {
          for (const location of version.locations) {
            const oldAbsolute = path.resolve(location.storageLocation.basePath, location.relativePath);
            const nextAbsolute = remapAbsolutePath(oldAbsolute);
            if (nextAbsolute && nextAbsolute !== oldAbsolute) {
              await tx.assetLocation.update({
                where: { id: location.id },
                data: { relativePath: path.relative(location.storageLocation.basePath, nextAbsolute).split(path.sep).join('/') },
              });
            }
          }
        }
        const memberRows = await tx.relationshipMember.findMany({
          where: { assetId: asset.id },
          select: { id: true, metadata: true },
        });
        for (const member of memberRows) {
          const metadata = member.metadata && typeof member.metadata === 'object' && !Array.isArray(member.metadata)
            ? member.metadata as Record<string, unknown>
            : {};
          await tx.relationshipMember.update({
            where: { id: member.id },
            data: { metadata: { ...metadata, filePath: nextFilePath } },
          });
        }
      }
    });
  } catch (error) {
    await rm(targetDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  const warnings: string[] = [];
  await rm(oldDirectory, { recursive: true, force: true }).catch((error) => {
    warnings.push(`Rename completed, but the old directory could not be removed: ${String(error)}`);
  });

  return { changed: true, baseName: allocatedBaseName, originalFilename: newOriginalFilename, warnings };
}

export async function renameArtwork(input: {
  userId: string;
  batchItemId: string;
  newBaseName: string;
}) {
  return withArtworkMutationLock(input.batchItemId, 'modified', () => renameArtworkUnlocked(input));
}
