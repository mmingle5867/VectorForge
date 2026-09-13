import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Prisma } from '@prisma/client';

import { withArtworkMutationLock } from '@/lib/artwork-mutation-lock';
import { getManagedArtworkDirectory, isPathInside, remapPathWithinDirectory } from '@/lib/artwork-storage-paths';
import prisma from '@/lib/prisma';
import { semaLocalToken } from '@/lib/sema-id';
import { configureAdditionalStorageForUser } from '@/services/profile-storage';
import { createCoreCommand } from '@/services/sema-core';

const PATH_FIELDS = [
  'uploadPath', 'upscaledPath', 'svgPath', 'aiPath', 'dxfPath', 'epsPath',
  'previewPath', 'outputFolderPath', 'zipPath', 'skuFilePath', 'metadataPath',
] as const;

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

function safeDirectoryName(value: string) {
  const result = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/g, '').slice(0, 160);
  if (!result || result === '.' || result === '..') throw new Error('Artwork has an invalid directory name');
  return result;
}

function normalizeRelative(basePath: string, filePath: string) {
  return path.relative(basePath, filePath).split(path.sep).join('/');
}

function legacyFolderFor(field: string | null, filePath: string) {
  if (field === 'original') return 'original';
  if (field === 'working') return path.join('vectorforge', 'working');
  if (['svgPath', 'aiPath', 'dxfPath', 'epsPath'].includes(field || '')) return path.join('vectorforge', 'vectorized');
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return path.join('vectorforge', 'png');
  if (extension === '.jpg' || extension === '.jpeg') return path.join('vectorforge', 'jpg');
  return path.join('vectorforge', 'manifest');
}

async function rewriteJsonPaths(directory: string, sourceDirectory: string | null, destinationDirectory: string) {
  for (const jsonPath of (await listFiles(directory)).filter((filePath) => path.extname(filePath).toLowerCase() === '.json')) {
    try {
      const current = await readFile(jsonPath, 'utf8');
      const updated = sourceDirectory ? current.split(sourceDirectory).join(destinationDirectory) : current;
      if (updated !== current) await writeFile(jsonPath, updated, 'utf8');
    } catch {
      // Optional or malformed manifests do not prevent a database-authoritative move.
    }
  }
}

async function moveArtworkUnlocked(input: {
  userId: string;
  batchItemId: string;
  destinationRootPath: string;
  makeDefaultImport?: boolean;
}) {
  const item = await prisma.batchItem.findFirst({
    where: { id: input.batchItemId, batch: { userId: input.userId } },
    include: {
      assets: { include: { versions: { include: { locations: { include: { storageLocation: true } } } } } },
    },
  });
  if (!item?.uploadPath) throw new Error('Artwork working copy was not found');

  const destination = await configureAdditionalStorageForUser({
    userId: input.userId,
    storageRootPath: input.destinationRootPath,
    makeDefaultImport: input.makeDefaultImport,
  });
  const sourceDirectory = getManagedArtworkDirectory(item.uploadPath);
  const directoryName = safeDirectoryName(sourceDirectory ? path.basename(sourceDirectory) : item.baseName);
  const targetDirectory = path.join(destination.paths.artwork, directoryName);
  if (sourceDirectory && path.resolve(sourceDirectory) === path.resolve(targetDirectory)) {
    return { changed: false, targetDirectory };
  }
  if (await exists(targetDirectory)) throw new Error(`Destination already contains artwork directory "${directoryName}"`);

  const moveOperation = await createCoreCommand({
    commandType: 'vectorforge.artwork.move',
    actorId: input.userId,
    subjectIds: [item.id],
    payload: { destinationRootPath: input.destinationRootPath },
  });
  const stagedDirectory = path.join(destination.paths.artwork, `.move-${semaLocalToken(moveOperation.id)}`);
  const exactPathMap = new Map<string, string>();
  const copiedLegacySources = new Set<string>();
  let legacyOriginalSource: string | null = null;
  let legacyOriginalTarget: string | null = null;

  try {
    if (sourceDirectory) {
      await cp(sourceDirectory, stagedDirectory, { recursive: true, errorOnExist: true, force: false });
    } else {
      const directories = ['original', 'vectorforge/working', 'vectorforge/vectorized', 'vectorforge/png', 'vectorforge/jpg', 'vectorforge/manifest'];
      await Promise.all(directories.map((directory) => mkdir(path.join(stagedDirectory, directory), { recursive: true })));

      const copyLegacyPath = async (sourceValue: string | null, field: string | null) => {
        if (!sourceValue) return;
        const sourcePath = path.resolve(sourceValue);
        if (field !== 'original' && exactPathMap.has(sourcePath)) return;
        if (!(await exists(sourcePath))) return;
        const sourceStats = await stat(sourcePath);
        const destinationFolder = path.join(stagedDirectory, legacyFolderFor(field, sourcePath));
        await mkdir(destinationFolder, { recursive: true });
        const destinationPath = path.join(destinationFolder, path.basename(sourcePath));
        if (await exists(destinationPath)) throw new Error(`Move would overwrite ${path.basename(destinationPath)}`);
        await cp(sourcePath, destinationPath, { recursive: sourceStats.isDirectory(), errorOnExist: true, force: false });
        if (field === 'original') {
          legacyOriginalSource = sourcePath;
          legacyOriginalTarget = destinationPath;
        } else {
          exactPathMap.set(sourcePath, destinationPath);
        }
        copiedLegacySources.add(sourcePath);
      };

      const originalAsset = item.assets.find((asset) => asset.role === 'original-file');
      await copyLegacyPath(item.uploadPath, 'working');
      await copyLegacyPath(originalAsset?.filePath || item.uploadPath, 'original');
      for (const field of PATH_FIELDS) await copyLegacyPath(item[field], field);
      for (const asset of item.assets) await copyLegacyPath(asset.filePath, asset.role === 'source-file' ? 'working' : asset.role === 'original-file' ? 'original' : null);
    }

    await rename(stagedDirectory, targetDirectory);

    const remap = (value: string | null) => {
      if (!value) return null;
      if (sourceDirectory) return remapPathWithinDirectory(value, sourceDirectory, targetDirectory);
      const mapped = exactPathMap.get(path.resolve(value));
      return mapped ? mapped.replace(stagedDirectory, targetDirectory) : value;
    };
    const remapAssetPath = (role: string, value: string | null) => {
      if (
        !sourceDirectory && role === 'original-file' && value && legacyOriginalSource &&
        path.resolve(value) === legacyOriginalSource && legacyOriginalTarget
      ) {
        return legacyOriginalTarget.replace(stagedDirectory, targetDirectory);
      }
      return remap(value);
    };

    await rewriteJsonPaths(targetDirectory, sourceDirectory, targetDirectory);
    const manifestPath = path.join(targetDirectory, 'vectorforge', 'manifest', 'manifest.json');
    if (!(await exists(manifestPath))) {
      await writeFile(manifestPath, `${JSON.stringify({
        schemaVersion: '1.0',
        manifestType: 'vectorforge-artwork',
        references: {
          itemId: item.itemId,
          artworkId: item.artworkId,
          workingAssetId: item.assets.find((asset) => asset.role === 'source-file')?.assetId ?? null,
        },
        files: {
          original: normalizeRelative(targetDirectory, remapAssetPath('original-file', item.assets.find((asset) => asset.role === 'original-file')?.filePath || item.uploadPath)!),
          working: normalizeRelative(targetDirectory, remap(item.uploadPath)!),
        },
        migratedAt: new Date().toISOString(),
      }, null, 2)}\n`, 'utf8');
    }

    const updateData: Record<string, string | null> = {};
    for (const field of PATH_FIELDS) updateData[field] = remap(item[field]);

    await prisma.$transaction(async (tx) => {
      await tx.batchItem.update({ where: { id: item.id }, data: updateData });
      for (const asset of item.assets) {
        const nextFilePath = remapAssetPath(asset.role, asset.filePath);
        if (nextFilePath !== asset.filePath) {
          await tx.asset.update({ where: { id: asset.id }, data: { filePath: nextFilePath } });
        }
        for (const version of asset.versions) {
          for (const location of version.locations) {
            const oldAbsolute = path.resolve(location.storageLocation.basePath, location.relativePath);
            const nextAbsolute = remapAssetPath(asset.role, oldAbsolute);
            if (!nextAbsolute || nextAbsolute === oldAbsolute) continue;
            await tx.assetLocation.update({
              where: { id: location.id },
              data: {
                storageLocationId: destination.location.id,
                relativePath: normalizeRelative(destination.location.basePath, nextAbsolute),
                status: 'AVAILABLE',
                verifiedAt: new Date(),
              },
            });
          }
        }
        const members = await tx.relationshipMember.findMany({ where: { assetId: asset.id }, select: { id: true, metadata: true } });
        for (const member of members) {
          const metadata = member.metadata && typeof member.metadata === 'object' && !Array.isArray(member.metadata)
            ? member.metadata as Prisma.JsonObject
            : {};
          await tx.relationshipMember.update({
            where: { id: member.id },
            data: { metadata: { ...metadata, filePath: nextFilePath } },
          });
        }
      }
    });

    const warnings: string[] = [];
    if (sourceDirectory) {
      await rm(sourceDirectory, { recursive: true, force: true }).catch((error) => warnings.push(`Destination is active, but the old directory could not be removed: ${String(error)}`));
    } else {
      for (const sourcePath of copiedLegacySources) {
        await rm(sourcePath, { recursive: true, force: true }).catch((error) => warnings.push(`Could not remove old path ${sourcePath}: ${String(error)}`));
      }
    }
    return { changed: true, targetDirectory, warnings };
  } catch (error) {
    await rm(stagedDirectory, { recursive: true, force: true }).catch(() => undefined);
    await rm(targetDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function moveArtwork(input: {
  userId: string;
  batchItemId: string;
  destinationRootPath: string;
  makeDefaultImport?: boolean;
}) {
  return withArtworkMutationLock(input.batchItemId, 'moved', () => moveArtworkUnlocked(input));
}

export async function moveArtworkBatch(input: {
  userId: string;
  batchItemIds: string[];
  destinationRootPath: string;
  makeDefaultImport?: boolean;
}) {
  const results: Array<
    { batchItemId: string; success: true; result: Awaited<ReturnType<typeof moveArtwork>> } |
    { batchItemId: string; success: false; error: string }
  > = [];
  for (const batchItemId of [...new Set(input.batchItemIds)]) {
    try {
      results.push({ batchItemId, success: true, result: await moveArtwork({ ...input, batchItemId }) });
    } catch (error) {
      results.push({
        batchItemId,
        success: false,
        error: error instanceof Error ? error.message : 'Unable to move artwork',
      });
    }
  }
  return results;
}
