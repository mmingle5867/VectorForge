import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { Prisma } from '@prisma/client';
import sharp from 'sharp';

import config from '@/lib/config';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { extractBaseName } from '@/lib/utils';
import { createAssetVersion } from '@/services/asset-versions';
import {
  configureDefaultImportStorageForUser,
  getVectorForgeStoragePaths,
} from '@/services/profile-storage';
import {
  ensureBatchItemSemaContext,
  upsertAssetForBatchItem,
} from '@/services/sema-identity';
import { semaLocalToken } from '@/lib/sema-id';
import { createCoreCommand } from '@/services/sema-core';
import { GRAPHICS_CAPABILITIES, resolveLocalGraphicsCapability } from '@/capabilities/graphics/registry';

const SUPPORTED_EXTENSIONS = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.svg', 'image/svg+xml'],
]);

const INBOX_SETTLE_TIME_MS = 1500;

export interface IngestInput {
  stagedPath: string;
  originalFilename: string;
  mimeType?: string | null;
}

export interface IngestedArtwork {
  id: string;
  batchId: string;
  originalFilename: string;
  baseName: string;
  workingDirectoryName: string;
  originalPath: string;
  workingPath: string;
  previewUrl: string;
}

function getStorageRootSetting(settings: { defaultSubstitutions: unknown } | null) {
  const values = settings?.defaultSubstitutions;
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    const value = (values as Record<string, unknown>).storageRootPath;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function sanitizeFileName(value: string) {
  const leaf = path.basename(value).trim();
  const extension = path.extname(leaf);
  const stem = leaf.slice(0, Math.max(0, leaf.length - extension.length));
  const safeStem = stem
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim() || 'artwork';
  return `${safeStem.slice(0, 180)}${extension.toLowerCase()}`;
}

function sanitizeDirectoryName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 160) || 'artwork';
}

function normalizeBaseName(value: string) {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function duplicateSequenceKey(profileId: string, normalizedBaseName: string) {
  const digest = createHash('sha256')
    .update(`${profileId}\0${normalizedBaseName}`)
    .digest('hex');
  return `ingest-directory:${digest}`;
}

async function reserveWorkingDirectoryName(profileId: string, requestedBaseName: string) {
  const baseName = sanitizeDirectoryName(requestedBaseName);
  const normalizedBaseName = normalizeBaseName(baseName);
  const sequenceKey = duplicateSequenceKey(profileId, normalizedBaseName);

  try {
    await prisma.numberSequence.create({
      data: {
        sequenceKey,
        label: `Ingest directory: ${baseName}`,
        prefix: baseName,
        paddingLength: 4,
        startingNumber: 1,
        nextNumber: 1,
      },
    });
    return baseName;
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'P2002'
    ) {
      throw error;
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "number_sequences"
      WHERE "sequenceKey" = ${sequenceKey}
      FOR UPDATE
    `;
    const sequence = await tx.numberSequence.findUnique({ where: { sequenceKey } });
    if (!sequence || !sequence.isActive) {
      throw new Error('Duplicate filename sequence is unavailable');
    }
    const number = sequence.nextNumber;
    await tx.numberSequence.update({
      where: { id: sequence.id },
      data: {
        nextNumber: number + 1,
        lastIssuedNumber: number,
      },
    });
    return `${baseName}-${String(number).padStart(4, '0')}`;
  });
}

async function reserveNumberedWorkingDirectoryName(profileId: string, requestedBaseName: string) {
  const baseName = sanitizeDirectoryName(requestedBaseName);
  const normalizedBaseName = normalizeBaseName(baseName);
  const sequenceKey = duplicateSequenceKey(profileId, normalizedBaseName);

  try {
    await prisma.numberSequence.create({
      data: {
        sequenceKey,
        label: `Ingest directory: ${baseName}`,
        prefix: baseName,
        paddingLength: 4,
        startingNumber: 1,
        nextNumber: 2,
        lastIssuedNumber: 1,
      },
    });
    return `${baseName}-0001`;
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "number_sequences"
      WHERE "sequenceKey" = ${sequenceKey}
      FOR UPDATE
    `;
    const sequence = await tx.numberSequence.findUnique({ where: { sequenceKey } });
    if (!sequence || !sequence.isActive) throw new Error('Duplicate filename sequence is unavailable');
    const number = sequence.nextNumber;
    await tx.numberSequence.update({
      where: { id: sequence.id },
      data: { nextNumber: number + 1, lastIssuedNumber: number },
    });
    return `${baseName}-${String(number).padStart(4, '0')}`;
  });
}

async function pathExists(value: string) {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

export async function reserveAvailableDirectoryName(
  profileId: string,
  baseName: string,
  artworkRoot: string
) {
  for (;;) {
    const candidate = await reserveWorkingDirectoryName(profileId, baseName);
    if (!(await pathExists(path.join(artworkRoot, candidate)))) return candidate;
  }
}

/** Reserves a permanent four-digit duplicate name, including -0001. */
export async function reserveAvailableNumberedDirectoryName(
  profileId: string,
  baseName: string,
  artworkRoot: string,
  unavailableNames = new Set<string>(),
) {
  for (;;) {
    const candidate = await reserveNumberedWorkingDirectoryName(profileId, baseName);
    if (
      !unavailableNames.has(normalizeBaseName(candidate)) &&
      !(await pathExists(path.join(artworkRoot, candidate)))
    ) {
      unavailableNames.add(normalizeBaseName(candidate));
      return candidate;
    }
  }
}

function relativeAssetPath(basePath: string, filePath: string) {
  return path.relative(basePath, filePath).split(path.sep).join('/');
}

async function hashFile(filePath: string) {
  const content = await readFile(filePath);
  return {
    sha256: createHash('sha256').update(content).digest('hex'),
    byteLength: content.byteLength,
  };
}

async function createIngestManifest(input: {
  manifestPath: string;
  workingDirectoryName: string;
  itemId: string;
  artworkId: string;
  assetId: string;
  originalRelativePath: string;
  workingRelativePath: string;
}) {
  await writeFile(
    input.manifestPath,
    `${JSON.stringify(
      {
        manifestType: 'VECTORFORGE.ARTWORK',
        manifestVersion: 1,
        workingDirectoryName: input.workingDirectoryName,
        references: {
          itemId: input.itemId,
          artworkId: input.artworkId,
          workingAssetId: input.assetId,
        },
        files: {
          original: input.originalRelativePath,
          working: input.workingRelativePath,
        },
        createdAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

async function ingestOne(input: {
  userId: string;
  batchId: string;
  sequenceNumber: number;
  ingest: IngestInput;
  profile: { id: string; profileId: string };
  location: { id: string; basePath: string };
}) {
  const stagedPath = path.resolve(input.ingest.stagedPath);
  const originalFilename = sanitizeFileName(input.ingest.originalFilename);
  const extension = path.extname(originalFilename).toLowerCase();
  const mimeType = input.ingest.mimeType || SUPPORTED_EXTENSIONS.get(extension) || null;
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file type: ${originalFilename}`);
  }
  await resolveLocalGraphicsCapability(GRAPHICS_CAPABILITIES.rasterTransform, {
    actorId: input.userId,
  });

  const storagePaths = getVectorForgeStoragePaths(input.location.basePath);
  const requestedBaseName = extractBaseName(originalFilename);
  const workingDirectoryName = await reserveAvailableDirectoryName(
    input.profile.id,
    requestedBaseName,
    storagePaths.artwork
  );
  const finalDirectory = path.join(storagePaths.artwork, workingDirectoryName);
  const ingestOperation = await createCoreCommand({
    commandType: 'vectorforge.artwork.ingest',
    actorId: input.userId,
    subjectIds: [input.batchId],
    payload: { originalFilename },
  });
  const temporaryDirectory = path.join(
    storagePaths.artwork,
    `.ingest-${semaLocalToken(ingestOperation.id)}`
  );
  const originalDirectory = path.join(temporaryDirectory, 'original');
  const vectorForgeDirectory = path.join(temporaryDirectory, 'vectorforge');
  const workingDirectory = path.join(vectorForgeDirectory, 'working');
  const manifestDirectory = path.join(vectorForgeDirectory, 'manifest');
  const temporaryOriginalPath = path.join(originalDirectory, originalFilename);
  const temporaryWorkingPath = path.join(workingDirectory, originalFilename);

  try {
    await Promise.all([
      mkdir(originalDirectory, { recursive: true }),
      mkdir(workingDirectory, { recursive: true }),
      mkdir(path.join(vectorForgeDirectory, 'vectorized'), { recursive: true }),
      mkdir(path.join(vectorForgeDirectory, 'png'), { recursive: true }),
      mkdir(path.join(vectorForgeDirectory, 'jpg'), { recursive: true }),
      mkdir(manifestDirectory, { recursive: true }),
    ]);
    await copyFile(stagedPath, temporaryOriginalPath);
    await copyFile(temporaryOriginalPath, temporaryWorkingPath);
    await rename(temporaryDirectory, finalDirectory);

    const originalPath = path.join(finalDirectory, 'original', originalFilename);
    const workingPath = path.join(
      finalDirectory,
      'vectorforge',
      'working',
      originalFilename
    );
    let originalWidth: number | null = null;
    let originalHeight: number | null = null;
    try {
      const metadata = await sharp(workingPath).metadata();
      originalWidth = metadata.width ?? null;
      originalHeight = metadata.height ?? null;
    } catch {
      // SVGs and partially supported formats may not expose raster dimensions.
    }
    const fileStats = await stat(workingPath);
    const batchItem = await prisma.batchItem.create({
      data: {
        batchId: input.batchId,
        originalFilename,
        baseName: requestedBaseName,
        sequenceNumber: input.sequenceNumber,
        mimeType,
        originalWidth,
        originalHeight,
        originalSize: fileStats.size,
        uploadPath: workingPath,
        upscaleFactor: config.processing.defaultUpscaleFactor,
      },
    });

    const context = await ensureBatchItemSemaContext({
      userId: input.userId,
      batchId: input.batchId,
      batchItemId: batchItem.id,
      title: requestedBaseName,
      sourceFilePath: workingPath,
      sourceMimeType: mimeType,
    });
    const originalAsset = await upsertAssetForBatchItem({
      batchItemId: batchItem.id,
      role: 'original-file',
      filePath: originalPath,
      mimeType,
      metadata: { immutableSource: true },
    });
    const digest = await hashFile(workingPath);
    await createAssetVersion({
      assetId: originalAsset.id,
      createdByProfileId: input.profile.id,
      storageLocationId: input.location.id,
      relativePath: relativeAssetPath(input.location.basePath, originalPath),
      ...digest,
      mimeType,
      status: 'APPROVED',
      verifiedAt: new Date(),
      metadata: { role: 'original-file', immutableSource: true },
    });
    await createAssetVersion({
      assetId: context.sourceAsset.id,
      createdByProfileId: input.profile.id,
      storageLocationId: input.location.id,
      relativePath: relativeAssetPath(input.location.basePath, workingPath),
      ...digest,
      mimeType,
      status: 'DRAFT',
      verifiedAt: new Date(),
      metadata: { role: 'working-copy', derivedFromAssetId: originalAsset.assetId },
    });

    await createIngestManifest({
      manifestPath: path.join(manifestDirectory.replace(temporaryDirectory, finalDirectory), 'manifest.json'),
      workingDirectoryName,
      itemId: context.item.itemId,
      artworkId: context.artwork.artworkNumber,
      assetId: context.sourceAsset.assetId,
      originalRelativePath: relativeAssetPath(finalDirectory, originalPath),
      workingRelativePath: relativeAssetPath(finalDirectory, workingPath),
    });
    await unlink(stagedPath);

    return {
      id: batchItem.id,
      batchId: input.batchId,
      originalFilename,
      baseName: requestedBaseName,
      workingDirectoryName,
      originalPath,
      workingPath,
      previewUrl: `/api/preview/${batchItem.id}`,
    } satisfies IngestedArtwork;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    await rm(finalDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function ingestStagedFiles(input: {
  userId: string;
  files: IngestInput[];
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { settings: true },
  });
  if (!user) throw new Error('User not found for ingest');
  const storage = await configureDefaultImportStorageForUser({
    userId: user.id,
    storageRootPath: getStorageRootSetting(user.settings),
  });
  const batch = await prisma.batch.create({
    data: {
      userId: user.id,
      totalItems: input.files.length,
      upscaleFactor: user.settings?.defaultUpscaleFactor ?? config.processing.defaultUpscaleFactor,
      smartUpscaleThreshold:
        user.settings?.smartUpscaleThreshold ?? config.processing.smartUpscaleThreshold,
      useBaseAssets: false,
      substitutionData: (user.settings?.defaultSubstitutions ?? {}) as Prisma.InputJsonValue,
      ownerId: storage.workspace.ownerId,
      workspaceId: storage.workspace.id,
    },
  });

  const files: IngestedArtwork[] = [];
  const errors: Array<{ filename: string; error: string }> = [];
  for (const [index, ingest] of input.files.entries()) {
    try {
      files.push(
        await ingestOne({
          userId: user.id,
          batchId: batch.id,
          sequenceNumber: index + 1,
          ingest,
          profile: storage.profile,
          location: storage.location,
        })
      );
    } catch (error) {
      errors.push({
        filename: ingest.originalFilename,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error('Artwork ingest failed', {
        userId: user.id,
        filename: ingest.originalFilename,
        error: errors.at(-1)?.error,
      });
    }
  }

  if (files.length === 0) {
    await prisma.batch.delete({ where: { id: batch.id } });
    return { batchId: null, files, errors, storage: storage.paths };
  }
  await prisma.batch.update({
    where: { id: batch.id },
    data: { totalItems: files.length },
  });
  return { batchId: batch.id, files, errors, storage: storage.paths };
}

async function nextStagingPath(processingDirectory: string, originalFilename: string) {
  const safeName = sanitizeFileName(originalFilename);
  const extension = path.extname(safeName);
  const stem = safeName.slice(0, safeName.length - extension.length);
  let candidate = path.join(processingDirectory, safeName);
  let counter = 1;
  while (await pathExists(candidate)) {
    candidate = path.join(
      processingDirectory,
      `${stem}-incoming-${String(counter).padStart(4, '0')}${extension}`
    );
    counter += 1;
  }
  return candidate;
}

export async function ingestUploadedFiles(input: { userId: string; files: File[] }) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { settings: true },
  });
  if (!user) throw new Error('User not found for upload');
  const storage = await configureDefaultImportStorageForUser({
    userId: user.id,
    storageRootPath: getStorageRootSetting(user.settings),
  });
  const staged: IngestInput[] = [];
  for (const file of input.files) {
    const stagedPath = await nextStagingPath(storage.paths.processing, file.name);
    await writeFile(stagedPath, Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
    staged.push({
      stagedPath,
      originalFilename: file.name,
      mimeType: file.type || SUPPORTED_EXTENSIONS.get(path.extname(file.name).toLowerCase()),
    });
  }
  return ingestStagedFiles({ userId: user.id, files: staged });
}

const scanPromises = new Map<
  string,
  Promise<Awaited<ReturnType<typeof ingestStagedFiles>> | null>
>();

export async function scanProcessingFolder(userId: string) {
  const activeScan = scanPromises.get(userId);
  if (activeScan) return activeScan;
  const scanPromise = (async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { settings: true },
    });
    if (!user) throw new Error('User not found for processing-folder scan');
    const storage = await configureDefaultImportStorageForUser({
      userId: user.id,
      storageRootPath: getStorageRootSetting(user.settings),
    });
    const entries = await readdir(storage.paths.processing, { withFileTypes: true });
    const now = Date.now();
    const files: IngestInput[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) continue;
      const stagedPath = path.join(storage.paths.processing, entry.name);
      const fileStats = await stat(stagedPath);
      if (now - fileStats.mtimeMs < INBOX_SETTLE_TIME_MS) continue;
      files.push({
        stagedPath,
        originalFilename: entry.name,
        mimeType: SUPPORTED_EXTENSIONS.get(extension),
      });
    }
    if (files.length === 0) return null;
    return ingestStagedFiles({ userId: user.id, files });
  })();
  scanPromises.set(userId, scanPromise);
  try {
    return await scanPromise;
  } finally {
    scanPromises.delete(userId);
  }
}
