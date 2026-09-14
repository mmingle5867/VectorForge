import { createHash } from 'node:crypto';
import { access, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { RasterEditorPreparation } from '@/lib/control-presets';
import prisma from '@/lib/prisma';
import { semaLocalToken } from '@/lib/sema-id';
import { createAssetVersion } from '@/services/asset-versions';
import { configureDefaultImportStorageForUser } from '@/services/profile-storage';
import { ensureBatchItemSemaContext } from '@/services/sema-identity';
import { createCoreCommand } from '@/services/sema-core';
import { issueSemaIdentifier } from '@/services/sema-core-identity';
import { ensureDirectWorkingJpeg } from '@/services/direct-working-raster';
import { getManagedArtworkDirectory } from '@/lib/artwork-storage-paths';
import { GRAPHICS_CAPABILITIES, resolveLocalGraphicsCapability } from '@/capabilities/graphics/registry';

export const MAX_RASTER_EDITOR_PIXELS = 64_000_000;

function getStorageRootSetting(settings: unknown) {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const value = (settings as Record<string, unknown>).storageRootPath;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function relativeAssetPath(basePath: string, filePath: string) {
  return path.relative(basePath, filePath).split(path.sep).join('/');
}

function isInsideDirectory(targetPath: string, directoryPath: string) {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(targetPath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function getWritableStorageLocationForFile(input: {
  profileId: string;
  workspaceId: string | null;
  defaultLocation: { id: string; basePath: string };
  filePath: string;
}) {
  if (isInsideDirectory(input.filePath, input.defaultLocation.basePath)) {
    return input.defaultLocation;
  }

  const registered = await prisma.storageLocation.findMany({
    where: {
      profileId: input.profileId,
      status: 'ACTIVE',
      isReadOnly: false,
    },
    select: { id: true, basePath: true },
  });
  const matching = registered
    .filter((location) => isInsideDirectory(input.filePath, location.basePath))
    .sort((left, right) => right.basePath.length - left.basePath.length)[0];
  if (matching) return matching;

  // Older VectorForge uploads predate registered Storage Locations. Register
  // their existing working directory without changing the default import path.
  const basePath = path.dirname(path.resolve(input.filePath));
  const pathId = createHash('sha256').update(basePath.toLowerCase()).digest('hex').slice(0, 12);
  const locationIdentifier = await issueSemaIdentifier('LOC', {
    purpose: 'legacy-working-storage-location',
  });
  return prisma.storageLocation.upsert({
    where: {
      profileId_name: {
        profileId: input.profileId,
        name: `VectorForge Legacy Working Files ${pathId}`,
      },
    },
    update: {
      workspaceId: input.workspaceId,
      basePath,
      status: 'ACTIVE',
      isReadOnly: false,
    },
    create: {
      locationId: locationIdentifier.id,
      profileId: input.profileId,
      workspaceId: input.workspaceId,
      name: `VectorForge Legacy Working Files ${pathId}`,
      kind: 'LOCAL_FILESYSTEM',
      basePath,
      isDefaultImport: false,
      isReadOnly: false,
      metadata: { application: 'VectorForge', purpose: 'legacy-working-files' },
    },
    select: { id: true, basePath: true },
  });
}

export async function prepareRasterForEditor(input: {
  userId: string;
  batchId: string;
  itemId: string;
  preparation: RasterEditorPreparation;
  sourceVersionKey?: string | null;
}) {
  let item = await prisma.batchItem.findFirst({
    where: { id: input.itemId, batchId: input.batchId, batch: { userId: input.userId } },
    include: {
      batch: true,
      assets: { where: { role: 'source-file' }, include: { versions: true } },
    },
  });
  if (!item?.uploadPath) throw new Error('Working raster file was not found');
  let sourceAsset: (typeof item.assets)[number] | undefined = item.assets[0];
  if (!sourceAsset) {
    await ensureBatchItemSemaContext({
      userId: input.userId,
      batchId: input.batchId,
      batchItemId: input.itemId,
      title: item.baseName || path.parse(item.originalFilename).name,
      sourceFilePath: item.uploadPath,
      sourceMimeType: item.mimeType,
    });
    item = await prisma.batchItem.findFirst({
      where: { id: input.itemId, batchId: input.batchId, batch: { userId: input.userId } },
      include: {
        batch: true,
        assets: { where: { role: 'source-file' }, include: { versions: true } },
      },
    });
    sourceAsset = item?.assets[0];
  }
  if (!item?.uploadPath || !sourceAsset) {
    throw new Error('The working raster could not be connected to its AssetID');
  }

  let sourcePath = path.resolve(item.uploadPath);
  if (input.sourceVersionKey) {
    sourcePath = await resolveRasterWorkingVersionPath({
      userId: input.userId,
      batchId: input.batchId,
      itemId: input.itemId,
      versionKey: input.sourceVersionKey,
    });
  }
  const blur = input.preparation.blur;
  const factor = input.preparation.upscaleFactor;
  if (blur === 0 && factor === 1) return { filePath: sourcePath, prepared: false };

  await resolveLocalGraphicsCapability(GRAPHICS_CAPABILITIES.rasterTransform);
  if (blur > 0) await resolveLocalGraphicsCapability(GRAPHICS_CAPABILITIES.rasterBlur);
  if (factor > 1) await resolveLocalGraphicsCapability(GRAPHICS_CAPABILITIES.rasterUpscale);

  const metadata = await sharp(sourcePath).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Unable to read raster dimensions');
  const outputWidth = metadata.width * factor;
  const outputHeight = metadata.height * factor;
  const outputPixels = outputWidth * outputHeight;
  if (outputPixels > MAX_RASTER_EDITOR_PIXELS) {
    throw new Error(
      `Prepared raster would be ${outputWidth.toLocaleString()} × ${outputHeight.toLocaleString()} pixels ` +
      `(${(outputPixels / 1_000_000).toFixed(1)} MP). The editor preparation limit is 64 MP. Choose a smaller upscale factor.`
    );
  }
  const nextVersion = Math.max(0, ...sourceAsset.versions.map((version) => version.versionNumber)) + 1;
  const parsed = path.parse(item.originalFilename);
  const artworkDirectory = getManagedArtworkDirectory(item.uploadPath) || getManagedArtworkDirectoryFromAnyArtworkFile(sourcePath);
  const outputDirectory = artworkDirectory ? path.join(artworkDirectory, 'vectorforge', 'working') : path.dirname(sourcePath);
  const outputPath = path.join(
    outputDirectory,
    `${parsed.name}-edit-v${String(nextVersion).padStart(4, '0')}${parsed.ext.toLowerCase()}`
  );
  const preparationOperation = await createCoreCommand({
    commandType: 'vectorforge.raster.prepare',
    actorId: input.userId,
    subjectIds: [sourceAsset.id],
    payload: { blur, upscaleFactor: factor },
  });
  // The full Core-issued ID remains in the issuance ledger. Only its locally
  // unique counter token is used in the temporary leaf to stay below Windows'
  // practical path limit.
  const temporaryPath = path.join(
    path.dirname(sourcePath),
    `.vf-${semaLocalToken(preparationOperation.id)}${parsed.ext.toLowerCase()}`
  );

  let pipeline = sharp(sourcePath);
  if (blur >= 0.3) pipeline = pipeline.blur(blur);
  if (factor > 1) {
    pipeline = pipeline.resize(outputWidth, outputHeight, {
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    });
  }

  try {
    await pipeline.toFile(temporaryPath);
    await rename(temporaryPath, outputPath);
    const content = await readFile(outputPath);
    const user = await prisma.user.findUnique({ where: { id: input.userId }, include: { settings: true } });
    if (!user) throw new Error('User not found');
    const storage = await configureDefaultImportStorageForUser({
      userId: user.id,
      storageRootPath: getStorageRootSetting(user.settings?.defaultSubstitutions),
    });
    const versionStorage = await getWritableStorageLocationForFile({
      profileId: storage.profile.id,
      workspaceId: storage.location.workspaceId,
      defaultLocation: storage.location,
      filePath: outputPath,
    });
    const version = await createAssetVersion({
      assetId: sourceAsset.id,
      createdByProfileId: storage.profile.id,
      storageLocationId: versionStorage.id,
      relativePath: relativeAssetPath(versionStorage.basePath, outputPath),
      sha256: createHash('sha256').update(content).digest('hex'),
      byteLength: content.byteLength,
      mimeType: item.mimeType,
      status: 'DRAFT',
      verifiedAt: new Date(),
      metadata: {
        role: 'raster-editor-working-copy',
        derivedFromPath: sourcePath,
        blur,
        upscaleFactor: factor,
      },
    });
    await prisma.$transaction([
      prisma.asset.update({ where: { id: sourceAsset.id }, data: { filePath: outputPath } }),
      prisma.batchItem.update({
        where: { id: item.id },
        data: {
          uploadPath: outputPath,
          upscaleApplied: factor > 1,
          upscaledWidth: factor > 1 ? outputWidth : null,
          upscaledHeight: factor > 1 ? outputHeight : null,
          upscaledPath: factor > 1 ? outputPath : null,
        },
      }),
    ]);
    const artworkDirectory = getManagedArtworkDirectory(outputPath) || getManagedArtworkDirectoryFromAnyArtworkFile(outputPath);
    const manifestPath = artworkDirectory
      ? path.join(artworkDirectory, 'vectorforge', 'manifest', 'manifest.json')
      : null;
    try {
      if (!artworkDirectory || !manifestPath) throw new Error('Legacy artwork has no managed manifest');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      const files = manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files)
        ? manifest.files as Record<string, unknown>
        : {};
      const references = manifest.references && typeof manifest.references === 'object' && !Array.isArray(manifest.references)
        ? manifest.references as Record<string, unknown>
        : {};
      await writeFile(manifestPath, `${JSON.stringify({
        ...manifest,
        files: { ...files, working: path.relative(artworkDirectory, outputPath).split(path.sep).join('/') },
        references: { ...references, workingAssetVersionId: version.assetVersionId },
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`, 'utf8');
    } catch {
      // Legacy artwork may not have an ingest manifest; the database remains authoritative.
    }
    return { filePath: outputPath, prepared: true, assetVersionId: version.assetVersionId };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function getManagedArtworkDirectoryFromAnyArtworkFile(filePath: string) {
  const directory = path.dirname(path.resolve(filePath));
  if (path.basename(directory).toLowerCase() === 'original') return path.dirname(directory);
  return getManagedArtworkDirectory(filePath);
}

type RasterVersionContext = {
  item: { id: string; uploadPath: string | null };
  sourceAsset: { id: string; assetId: string; filePath: string | null };
  originalAsset: { id: string; assetId: string; filePath: string | null } | null;
};

async function getRasterVersionContext(userId: string, batchId: string, itemId: string): Promise<RasterVersionContext> {
  const item = await prisma.batchItem.findFirst({
    where: { id: itemId, batchId, batch: { userId } },
    select: {
      id: true,
      uploadPath: true,
      assets: {
        where: { role: { in: ['source-file', 'original-file'] } },
        select: { id: true, assetId: true, role: true, filePath: true },
      },
    },
  });
  const sourceAsset = item?.assets.find((asset) => asset.role === 'source-file');
  if (!item || !sourceAsset) throw new Error('Working raster version context was not found');
  const originalAsset = item.assets.find((asset) => asset.role === 'original-file') ?? null;
  return { item, sourceAsset, originalAsset };
}

export async function listRasterWorkingVersions(input: { userId: string; batchId: string; itemId: string }) {
  const context = await getRasterVersionContext(input.userId, input.batchId, input.itemId);
  const versions = await prisma.assetVersion.findMany({
    where: { assetId: context.sourceAsset.id, status: { not: 'RETIRED' } },
    orderBy: [{ versionNumber: 'desc' }],
    include: {
      locations: {
        where: { isPrimary: true },
        include: { storageLocation: { select: { basePath: true } } },
        take: 1,
      },
    },
  });
  const currentPath = path.resolve(context.sourceAsset.filePath ?? context.item.uploadPath ?? '');
  const dimensions = async (filePath: string | null) => {
    if (!filePath) return { width: null, height: null };
    try { const info = await sharp(filePath).metadata(); return { width: info.width ?? null, height: info.height ?? null }; }
    catch { return { width: null, height: null }; }
  };
  const listed = await Promise.all(versions.map(async (version) => {
    const location = version.locations[0];
    const filePath = location ? path.resolve(location.storageLocation.basePath, location.relativePath) : null;
    return { key: version.id, assetVersionId: version.assetVersionId, versionNumber: version.versionNumber, filePath, isCurrent: Boolean(filePath && path.resolve(filePath) === currentPath), createdAt: version.createdAt, metadata: version.metadata, ...(await dimensions(filePath)) };
  }));
  return {
    currentPath,
    original: context.originalAsset?.filePath ? {
      key: 'original',
      label: 'Untouched original',
      filePath: context.originalAsset.filePath,
      ...(await dimensions(context.originalAsset.filePath)),
    } : null,
    versions: listed.filter((version) => Boolean(version.filePath)),
  };
}

export async function readRasterWorkingVersionPreview(input: { userId: string; batchId: string; itemId: string; versionKey: string }) {
  const filePath = await resolveRasterWorkingVersionPath(input);
  return { filePath, content: await readFile(filePath) };
}

async function resolveRasterWorkingVersionPath(input: { userId: string; batchId: string; itemId: string; versionKey: string }) {
  const context = await getRasterVersionContext(input.userId, input.batchId, input.itemId);
  let filePath = input.versionKey === 'original' ? context.originalAsset?.filePath ?? null : null;
  if (!filePath) {
    const version = await prisma.assetVersion.findFirst({
      where: { id: input.versionKey, assetId: context.sourceAsset.id, status: { not: 'RETIRED' } },
      include: { locations: { where: { isPrimary: true }, include: { storageLocation: { select: { basePath: true } }, }, take: 1 } },
    });
    const location = version?.locations[0];
    filePath = location ? path.resolve(location.storageLocation.basePath, location.relativePath) : null;
  }
  if (!filePath) throw new Error('Selected raster version is unavailable');
  await access(filePath);
  return filePath;
}

export async function activateRasterWorkingVersion(input: {
  userId: string;
  batchId: string;
  itemId: string;
  versionKey: string;
}) {
  const context = await getRasterVersionContext(input.userId, input.batchId, input.itemId);
  let filePath: string | null = null;
  let versionReference: string | null = null;

  if (input.versionKey === 'original') {
    filePath = context.originalAsset?.filePath ?? null;
  } else {
    const version = await prisma.assetVersion.findFirst({
      where: { id: input.versionKey, assetId: context.sourceAsset.id, status: { not: 'RETIRED' } },
      include: {
        locations: {
          where: { isPrimary: true },
          include: { storageLocation: { select: { basePath: true } } },
          take: 1,
        },
      },
    });
    const location = version?.locations[0];
    filePath = location ? path.resolve(location.storageLocation.basePath, location.relativePath) : null;
    versionReference = version?.assetVersionId ?? null;
  }
  if (!filePath) throw new Error('Selected raster version is unavailable');
  await access(filePath);

  await createCoreCommand({
    commandType: 'vectorforge.raster.activate-version',
    actorId: input.userId,
    subjectIds: [context.sourceAsset.id],
    payload: { batchId: input.batchId, itemId: input.itemId, versionKey: input.versionKey },
  });
  await prisma.$transaction([
    prisma.asset.update({ where: { id: context.sourceAsset.id }, data: { filePath } }),
    prisma.batchItem.update({
      where: { id: context.item.id },
      data: { uploadPath: filePath, upscaleApplied: false, upscaledPath: null, upscaledWidth: null, upscaledHeight: null },
    }),
  ]);

  const artworkDirectory = getManagedArtworkDirectory(filePath);
  if (artworkDirectory) {
    const manifestPath = path.join(artworkDirectory, 'vectorforge', 'manifest', 'manifest.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      const files = manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files) ? manifest.files as Record<string, unknown> : {};
      const references = manifest.references && typeof manifest.references === 'object' && !Array.isArray(manifest.references) ? manifest.references as Record<string, unknown> : {};
      await writeFile(manifestPath, `${JSON.stringify({
        ...manifest,
        files: { ...files, working: path.relative(artworkDirectory, filePath).split(path.sep).join('/') },
        references: { ...references, workingAssetVersionId: versionReference },
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`, 'utf8');
    } catch {
      // Database state remains authoritative for legacy artwork without a manifest.
    }
  }
  return { filePath, versionReference };
}

async function getDirectRasterContext(userId: string, artworkId: string) {
  const artwork = await prisma.artwork.findFirst({
    where: { id: artworkId, userId, status: 'ACTIVE', batchItems: { none: {} } },
    include: { assets: { where: { role: { in: ['source-file', 'original-file'] } }, include: { versions: { include: { locations: { include: { storageLocation: true } } } } } } },
  });
  const sourceAsset = artwork?.assets.find((asset) => asset.role === 'source-file');
  const originalAsset = artwork?.assets.find((asset) => asset.role === 'original-file') ?? null;
  if (!artwork || !sourceAsset?.filePath) throw new Error('Working raster version context was not found');
  return { artwork, sourceAsset, originalAsset };
}

function directVersionPath(version: { locations: Array<{ storageLocation: { basePath: string }; relativePath: string }> }) {
  const location = version.locations[0];
  return location ? path.resolve(location.storageLocation.basePath, location.relativePath) : null;
}

export async function listDirectRasterWorkingVersions(input: { userId: string; artworkId: string }) {
  const { artwork, sourceAsset, originalAsset } = await getDirectRasterContext(input.userId, input.artworkId);
  const savedOutputAssets = await prisma.asset.findMany({
    where: {
      artworkId: input.artworkId,
      status: 'ACTIVE',
      role: { in: ['approved-svg', 'approved-png', 'approved-jpg'] },
    },
    select: { role: true, filePath: true },
  });
  const versions = await prisma.assetVersion.findMany({ where: { assetId: sourceAsset.id, status: { not: 'RETIRED' } }, orderBy: { versionNumber: 'desc' }, include: { locations: { where: { isPrimary: true }, include: { storageLocation: { select: { basePath: true } } }, take: 1 } } });
  const currentPath = path.resolve(sourceAsset.filePath!);
  const dimensions = async (filePath: string | null) => {
    if (!filePath) return { width: null, height: null };
    try { const metadata = await sharp(filePath).metadata(); return { width: metadata.width ?? null, height: metadata.height ?? null }; }
    catch { return { width: null, height: null }; }
  };
  const originalPath = originalAsset?.filePath ?? null;
  const availableVersions = (await Promise.all(versions.map(async (version) => {
    const filePath = directVersionPath(version);
    return {
      key: version.id, assetVersionId: version.assetVersionId, versionNumber: version.versionNumber, filePath,
      isCurrent: Boolean(filePath && path.resolve(filePath) === currentPath), createdAt: version.createdAt,
      metadata: version.metadata, ...(await dimensions(filePath)),
    };
  }))).filter((version) => Boolean(version.filePath));
  return {
    currentPath,
    artworkName: artwork.outputBaseName || artwork.title,
    original: originalPath ? { key: 'original', label: 'Untouched original', filePath: originalPath, ...(await dimensions(originalPath)) } : null,
    versions: availableVersions,
    savedOutputs: {
      svg: savedOutputAssets.some((asset) => asset.role === 'approved-svg' && Boolean(asset.filePath)),
      png: savedOutputAssets.some((asset) => asset.role === 'approved-png' && Boolean(asset.filePath)),
      jpg: savedOutputAssets.some((asset) => asset.role === 'approved-jpg' && Boolean(asset.filePath)),
    },
  };
}

async function resolveDirectRasterPath(userId: string, artworkId: string, versionKey: string) {
  const { sourceAsset, originalAsset } = await getDirectRasterContext(userId, artworkId);
  let filePath = versionKey === 'original' ? originalAsset?.filePath ?? null : null;
  let mimeType = versionKey === 'original' ? originalAsset?.mimeType ?? null : null;
  if (!filePath) {
    const version = await prisma.assetVersion.findFirst({ where: { id: versionKey, assetId: sourceAsset.id, status: { not: 'RETIRED' } }, include: { locations: { where: { isPrimary: true }, include: { storageLocation: { select: { basePath: true } } }, take: 1 } } });
    filePath = version ? directVersionPath(version) : null;
    mimeType = version?.mimeType ?? null;
  }
  if (!filePath) throw new Error('Selected raster version is unavailable');
  await access(filePath);
  return { sourceAsset, filePath, mimeType };
}

export async function activateDirectRasterWorkingVersion(input: { userId: string; artworkId: string; versionKey: string }) {
  const { sourceAsset, filePath, mimeType } = await resolveDirectRasterPath(input.userId, input.artworkId, input.versionKey);
  const metadata = sourceAsset.metadata && typeof sourceAsset.metadata === 'object' && !Array.isArray(sourceAsset.metadata)
    ? sourceAsset.metadata as Record<string, unknown>
    : {};
  await prisma.asset.update({ where: { id: sourceAsset.id }, data: { filePath, mimeType, metadata: { ...metadata, jpegReadyForVectorizing: false } } });
  await createCoreCommand({ commandType: 'vectorforge.raster.activate-version', actorId: input.userId, subjectIds: [input.artworkId, sourceAsset.id], payload: { versionKey: input.versionKey } });
  return { filePath };
}

export async function prepareDirectRasterForEditor(input: { userId: string; artworkId: string; preparation: RasterEditorPreparation; sourceVersionKey?: string | null }) {
  // The artwork-first workflow always prepares from the persistent working
  // JPEG.  A non-JPEG intake is converted once before any edit/blur/upscale
  // action, rather than repeatedly editing its original WEBP or PNG.
  await ensureDirectWorkingJpeg({ userId: input.userId, artworkId: input.artworkId });
  const context = await getDirectRasterContext(input.userId, input.artworkId);
  // The current asset path is authoritative.  Do not silently use the newest
  // historical version: it may already be an enlarged edit.
  const key = input.sourceVersionKey || null;
  const resolved = key
    ? await resolveDirectRasterPath(input.userId, input.artworkId, key)
    : { sourceAsset: context.sourceAsset, filePath: path.resolve(context.sourceAsset.filePath!) };
  const { sourceAsset, filePath: sourcePath } = resolved;
  const { blur, upscaleFactor: factor } = input.preparation;
  if (blur === 0 && factor === 1) return { filePath: sourcePath, prepared: false };
  const meta = await sharp(sourcePath).metadata();
  if (!meta.width || !meta.height) throw new Error('Unable to read raster dimensions');
  if (meta.width * factor * meta.height * factor > MAX_RASTER_EDITOR_PIXELS) throw new Error('Prepared raster exceeds the 64 MP editor preparation limit. Choose a smaller upscale factor.');
  await resolveLocalGraphicsCapability(GRAPHICS_CAPABILITIES.rasterTransform);
  const dir = path.dirname(sourceAsset.filePath!);
  const parsed = path.parse(sourceAsset.filePath!);
  const next = Math.max(0, ...sourceAsset.versions.map((version) => version.versionNumber)) + 1;
  const outputPath = path.join(dir, `${parsed.name}-edit-v${String(next).padStart(4, '0')}${parsed.ext.toLowerCase()}`);
  const command = await createCoreCommand({ commandType: 'vectorforge.raster.prepare', actorId: input.userId, subjectIds: [input.artworkId, sourceAsset.id], payload: { blur, upscaleFactor: factor } });
  const temporaryPath = path.join(dir, `.vf-${semaLocalToken(command.id)}${parsed.ext.toLowerCase()}`);
  let pipeline = sharp(sourcePath); if (blur >= 0.3) pipeline = pipeline.blur(blur); if (factor > 1) pipeline = pipeline.resize(meta.width * factor, meta.height * factor, { kernel: sharp.kernel.lanczos3 });
  try {
    await pipeline.toFile(temporaryPath); await rename(temporaryPath, outputPath);
  const user = await prisma.user.findUnique({ where: { id: input.userId }, include: { settings: true } }); if (!user) throw new Error('User not found');
  const storage = await configureDefaultImportStorageForUser({ userId: input.userId, storageRootPath: getStorageRootSetting(user.settings?.defaultSubstitutions) });
  const contents = await readFile(outputPath);
  const versionStorage = await getWritableStorageLocationForFile({ profileId: storage.profile.id, workspaceId: storage.location.workspaceId, defaultLocation: storage.location, filePath: outputPath });
  const version = await createAssetVersion({ assetId: sourceAsset.id, createdByProfileId: storage.profile.id, storageLocationId: versionStorage.id, relativePath: relativeAssetPath(versionStorage.basePath, outputPath), sha256: createHash('sha256').update(contents).digest('hex'), byteLength: contents.byteLength, mimeType: sourceAsset.mimeType, status: 'DRAFT', verifiedAt: new Date(), metadata: { role: 'raster-editor-working-copy', blur, upscaleFactor: factor, derivedFromPath: sourcePath } });
  await prisma.asset.update({ where: { id: sourceAsset.id }, data: { filePath: outputPath } });
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
    return { filePath: outputPath, prepared: true, assetVersionId: version.assetVersionId };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined);
    throw error;
  }
}
