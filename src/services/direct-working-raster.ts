import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { isHexColor } from '@/lib/tuning-defaults';
import { createAssetVersion } from '@/services/asset-versions';
import { createFixedCanvasRaster } from '@/services/raster-export';
import { getWritableStorageLocationForFile } from '@/services/raster-editor-preparation';
import { configureDefaultImportStorageForUser } from '@/services/profile-storage';
import { createCoreCommand } from '@/services/sema-core';
import { issueSemaIdentifier } from '@/services/sema-core-identity';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function isJpeg(filePath: string | null, mimeType: string | null) {
  return mimeType === 'image/jpeg' || mimeType === 'image/jpg' || /\.jpe?g$/i.test(filePath || '');
}

function storageRootFromSettings(defaultSubstitutions: unknown) {
  const value = asRecord(defaultSubstitutions).storageRootPath;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function outputRasterSettings(defaultSubstitutions: unknown) {
  const values = asRecord(defaultSubstitutions);
  const threshold = Number(values.pngWhiteTransparencyThreshold);
  const width = Number(values.rasterExportWidth);
  const height = Number(values.rasterExportHeight);
  return {
    pngColor: isHexColor(values.pngExportArtworkColor) ? values.pngExportArtworkColor : config.processing.pngExportArtworkColor,
    whiteTransparencyThreshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 255 ? Math.round(threshold) : config.processing.pngWhiteTransparencyThreshold,
    width: Number.isFinite(width) && width >= 256 && width <= 10000 ? Math.round(width) : config.processing.rasterExportWidth,
    height: Number.isFinite(height) && height >= 256 && height <= 10000 ? Math.round(height) : config.processing.rasterExportHeight,
  };
}

async function directContext(userId: string, artworkId: string) {
  const artwork = await prisma.artwork.findFirst({
    where: { id: artworkId, userId, status: 'ACTIVE', batchItems: { none: {} } },
    include: {
      assets: {
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      },
    },
  });
  const workingJpeg = artwork?.assets.find((asset) => asset.role === 'source-file');
  if (!artwork || !workingJpeg?.filePath) throw new Error('Working raster was not found');
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { settings: true } });
  if (!user) throw new Error('User was not found');
  const storage = await configureDefaultImportStorageForUser({
    userId,
    storageRootPath: storageRootFromSettings(user.settings?.defaultSubstitutions),
  });
  return { artwork, workingJpeg, user, storage };
}

function nextJpegPath(currentPath: string, versions: Array<{ versionNumber: number }>) {
  const parsed = path.parse(currentPath);
  const number = Math.max(0, ...versions.map((version) => version.versionNumber)) + 1;
  return path.join(path.dirname(currentPath), `${parsed.name}-working-v${String(number).padStart(4, '0')}.jpg`);
}

/** Ensures the persistent current working image is a JPEG, without touching the original asset. */
export async function ensureDirectWorkingJpeg(input: { userId: string; artworkId: string }) {
  const context = await directContext(input.userId, input.artworkId);
  const { artwork, workingJpeg, user, storage } = context;
  const metadata = asRecord(workingJpeg.metadata);
  if (isJpeg(workingJpeg.filePath, workingJpeg.mimeType)) {
    if (metadata.workingFormat !== 'JPEG') {
      await prisma.asset.update({
        where: { id: workingJpeg.id },
        data: { mimeType: 'image/jpeg', metadata: { ...metadata, workingFormat: 'JPEG', jpegReadyForVectorizing: metadata.jpegReadyForVectorizing === true } },
      });
    }
    return { created: false, filePath: workingJpeg.filePath, jpegReady: metadata.jpegReadyForVectorizing === true };
  }

  const sourcePath = workingJpeg.filePath;
  if (!sourcePath) throw new Error('Working raster was not found');
  await access(sourcePath);
  const outputPath = nextJpegPath(sourcePath, workingJpeg.versions);
  const command = await createCoreCommand({
    commandType: 'vectorforge.working-jpeg.create',
    actorId: input.userId,
    workspaceId: artwork.workspaceId,
    subjectIds: [artwork.id, workingJpeg.id],
    payload: { sourcePath },
  });
  try {
    await sharp(sourcePath).flatten({ background: '#ffffff' }).jpeg({ quality: 95 }).toFile(outputPath);
    const contents = await readFile(outputPath);
    const location = await getWritableStorageLocationForFile({
      profileId: storage.profile.id,
      workspaceId: artwork.workspaceId,
      defaultLocation: storage.location,
      filePath: outputPath,
    });
    await createAssetVersion({
      assetId: workingJpeg.id,
      createdByProfileId: storage.profile.id,
      storageLocationId: location.id,
      relativePath: path.relative(location.basePath, outputPath).split(path.sep).join('/'),
      sha256: createHash('sha256').update(contents).digest('hex'),
      byteLength: contents.byteLength,
      mimeType: 'image/jpeg',
      status: 'DRAFT',
      metadata: { role: 'working-jpeg', convertedFrom: sourcePath, jpegReadyForVectorizing: false },
    });
    await prisma.$transaction([
      prisma.asset.update({
        where: { id: workingJpeg.id },
        data: { filePath: outputPath, mimeType: 'image/jpeg', metadata: { ...metadata, workingFormat: 'JPEG', jpegReadyForVectorizing: false } },
      }),
      prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } }),
    ]);
    return { created: true, filePath: outputPath, jpegReady: false };
  } catch (error) {
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined);
    throw error;
  }
}

export async function markDirectWorkingJpegReady(input: { userId: string; artworkId: string }) {
  await ensureDirectWorkingJpeg(input);
  const { artwork, workingJpeg } = await directContext(input.userId, input.artworkId);
  const workingPngExists = artwork.assets.some((asset) => asset.role === 'working-png' && asset.status === 'ACTIVE' && Boolean(asset.filePath));
  // A ready JPG always has an accompanying PNG available for review/editing.
  // Existing working PNG edits are preserved and are never overwritten here.
  if (!workingPngExists) await createDirectWorkingPng(input);
  const metadata = asRecord(workingJpeg.metadata);
  await prisma.asset.update({ where: { id: workingJpeg.id }, data: { metadata: { ...metadata, workingFormat: 'JPEG', jpegReadyForVectorizing: true } } });
  const command = await createCoreCommand({ commandType: 'vectorforge.working-jpeg.ready', actorId: input.userId, workspaceId: artwork.workspaceId, subjectIds: [artwork.id, workingJpeg.id] });
  await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
  return { jpegReady: true, filePath: workingJpeg.filePath, pngCreated: !workingPngExists };
}

export async function createDirectWorkingPng(input: { userId: string; artworkId: string }) {
  await ensureDirectWorkingJpeg(input);
  const { artwork, workingJpeg, user, storage } = await directContext(input.userId, input.artworkId);
  if (!isJpeg(workingJpeg.filePath, workingJpeg.mimeType)) throw new Error('Create a working JPG before creating PNG');
  const settings = outputRasterSettings(user.settings?.defaultSubstitutions);
  const outputPath = path.join(path.dirname(workingJpeg.filePath!), `${path.parse(workingJpeg.filePath!).name}.png`);
  const command = await createCoreCommand({
    commandType: 'vectorforge.working-png.create', actorId: input.userId, workspaceId: artwork.workspaceId,
    subjectIds: [artwork.id, workingJpeg.id], payload: { workingJpegPath: workingJpeg.filePath, outputPath },
  });
  try {
    await createFixedCanvasRaster(await readFile(workingJpeg.filePath!), outputPath, {
      width: settings.width, height: settings.height, format: 'png', artworkColor: settings.pngColor,
      whiteTransparencyThreshold: settings.whiteTransparencyThreshold,
    });
    const contents = await readFile(outputPath);
    const location = await getWritableStorageLocationForFile({ profileId: storage.profile.id, workspaceId: artwork.workspaceId, defaultLocation: storage.location, filePath: outputPath });
    let pngAsset = artwork.assets.find((asset) => asset.role === 'working-png');
    if (!pngAsset) {
      const issued = await issueSemaIdentifier('AST', { purpose: 'working-png' });
      pngAsset = await prisma.asset.create({ data: { id: issued.id, assetId: issued.id, ownerId: artwork.ownerId!, workspaceId: artwork.workspaceId!, itemId: artwork.itemId!, artworkId: artwork.id, role: 'working-png', filePath: outputPath, mimeType: 'image/png', metadata: { workingFormat: 'PNG' } }, include: { versions: true } });
    } else {
      pngAsset = await prisma.asset.update({ where: { id: pngAsset.id }, data: { filePath: outputPath, mimeType: 'image/png', metadata: { ...asRecord(pngAsset.metadata), workingFormat: 'PNG' } }, include: { versions: true } });
    }
    await createAssetVersion({
      assetId: pngAsset.id, createdByProfileId: storage.profile.id, storageLocationId: location.id,
      relativePath: path.relative(location.basePath, outputPath).split(path.sep).join('/'), sha256: createHash('sha256').update(contents).digest('hex'), byteLength: contents.byteLength,
      mimeType: 'image/png', status: 'DRAFT', metadata: { role: 'working-png', derivedFromWorkingJpeg: workingJpeg.filePath },
    });
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
    return { filePath: outputPath };
  } catch (error) {
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined);
    throw error;
  }
}

export async function getDirectWorkingRasterState(input: { userId: string; artworkId: string }) {
  await ensureDirectWorkingJpeg(input);
  const { artwork, workingJpeg } = await directContext(input.userId, input.artworkId);
  const png = artwork.assets.find((asset) => asset.role === 'working-png' && asset.status === 'ACTIVE');
  const metadata = asRecord(workingJpeg.metadata);
  return {
    jpegReady: metadata.jpegReadyForVectorizing === true,
    workingJpeg: { filePath: workingJpeg.filePath, label: path.basename(workingJpeg.filePath || 'working.jpg') },
    workingPng: png?.filePath ? { filePath: png.filePath, label: path.basename(png.filePath) } : null,
  };
}
