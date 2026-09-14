import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import config from '@/lib/config';
import { getManagedArtworkDirectory } from '@/lib/artwork-storage-paths';
import { isHexColor } from '@/lib/tuning-defaults';
import { createAssetVersion } from '@/services/asset-versions';
import { getWritableStorageLocationForFile } from '@/services/raster-editor-preparation';
import { createCoreCommand } from '@/services/sema-core';
import { issueSemaIdentifier } from '@/services/sema-core-identity';
import { createFixedCanvasRaster } from '@/services/raster-export';
import { previewTuneSchema, type PreviewTuneSettings } from '@/services/tuned-svg';

async function recordApprovedOutput(input: { artwork: { id: string; ownerId: string | null; workspaceId: string | null; itemId: string | null }; role: string; filePath: string; mimeType: string; profileId: string; storageLocationId: string; storageBasePath: string; reviewStatus: 'APPROVED' | 'NEEDS_VECTOR_EDIT' }) {
  if (!input.artwork.ownerId || !input.artwork.workspaceId || !input.artwork.itemId) throw new Error('Artwork Foundation context is incomplete');
  let asset = await prisma.asset.findFirst({ where: { artworkId: input.artwork.id, role: input.role, status: 'ACTIVE' } });
  if (!asset) {
    const issued = await issueSemaIdentifier('AST', { purpose: 'approved-artwork-output', role: input.role });
    asset = await prisma.asset.create({ data: { id: issued.id, assetId: issued.id, ownerId: input.artwork.ownerId, workspaceId: input.artwork.workspaceId, itemId: input.artwork.itemId, artworkId: input.artwork.id, role: input.role, filePath: input.filePath, mimeType: input.mimeType, metadata: { approved: true, reviewStatus: input.reviewStatus } } });
  } else asset = await prisma.asset.update({ where: { id: asset.id }, data: { filePath: input.filePath, mimeType: input.mimeType, metadata: { approved: true, reviewStatus: input.reviewStatus } } });
  const contents = await readFile(input.filePath);
  const version = await createAssetVersion({ assetId: asset.id, createdByProfileId: input.profileId, storageLocationId: input.storageLocationId, relativePath: path.relative(input.storageBasePath, input.filePath).split(path.sep).join('/'), sha256: createHash('sha256').update(contents).digest('hex'), byteLength: contents.byteLength, mimeType: input.mimeType, status: 'APPROVED', verifiedAt: new Date(), metadata: { approvedOutput: true, role: input.role } });
  return { asset, version };
}

function outputRasterSettings(defaultSubstitutions: unknown) {
  const values = defaultSubstitutions && typeof defaultSubstitutions === 'object' && !Array.isArray(defaultSubstitutions)
    ? defaultSubstitutions as Record<string, unknown>
    : {};
  const configuredThreshold = Number(values.pngWhiteTransparencyThreshold);
  return {
    pngColor: isHexColor(values.pngExportArtworkColor)
      ? values.pngExportArtworkColor
      : config.processing.pngExportArtworkColor,
    whiteTransparencyThreshold: Number.isFinite(configuredThreshold) && configuredThreshold >= 0 && configuredThreshold <= 255
      ? Math.round(configuredThreshold)
      : config.processing.pngWhiteTransparencyThreshold,
  };
}

function outputBaseName(value: string | null | undefined) {
  const base = path.parse(path.basename(value || '')).name
    .replace(/-(?:edit|working)-v\d+$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .trim();
  return base || null;
}

/** Approve one direct artwork. No Batch, package, marketplace, ZIP, or listing records are created. */
export async function approveDirectArtwork(input: { userId: string; artworkId: string; settings: unknown; upscaleFactor?: number; candidateId: string; reviewStatus?: string }) {
  const artwork = await prisma.artwork.findFirst({ where: { id: input.artworkId, userId: input.userId, status: 'ACTIVE', batchItems: { none: {} } }, include: { assets: true } });
  const working = artwork?.assets.find((asset) => asset.role === 'source-file');
  const original = artwork?.assets.find((asset) => asset.role === 'original-file' && asset.status === 'ACTIVE');
  const workingPng = artwork?.assets.find((asset) => asset.role === 'working-png' && asset.status === 'ACTIVE');
  if (!artwork || !working?.filePath) throw new Error('Artwork working copy was not found');
  const workingMetadata = working.metadata && typeof working.metadata === 'object' && !Array.isArray(working.metadata)
    ? working.metadata as Record<string, unknown>
    : {};
  if (workingMetadata.jpegReadyForVectorizing !== true) throw new Error('Mark the working JPG ready before saving vector outputs');
  const directory = getManagedArtworkDirectory(working.filePath);
  if (!directory) throw new Error('Artwork has no managed directory');
  const profile = await prisma.semaProfile.findFirst({ where: { userId: input.userId, status: 'ACTIVE' } });
  const user = await prisma.user.findUnique({ where: { id: input.userId }, include: { settings: true } });
  const defaultLocation = profile ? await prisma.storageLocation.findFirst({ where: { profileId: profile.id, status: 'ACTIVE', isReadOnly: false }, orderBy: { isDefaultImport: 'desc' } }) : null;
  if (!profile || !defaultLocation || !user) throw new Error('Active writable storage location was not found');
  const rasterSettings = outputRasterSettings(user.settings?.defaultSubstitutions);
  const reviewStatus = input.reviewStatus === 'NEEDS_VECTOR_EDIT' ? 'NEEDS_VECTOR_EDIT' : 'APPROVED';
  const command = await createCoreCommand({ commandType: 'vectorforge.artwork.approve', actorId: input.userId, workspaceId: artwork.workspaceId, subjectIds: [artwork.id, working.id], payload: { settings: input.settings as Prisma.InputJsonValue, upscaleFactor: input.upscaleFactor ?? 1 } });
  try {
    const settings: PreviewTuneSettings = previewTuneSchema.parse(input.settings);
    const candidateId = input.candidateId;
    if (typeof candidateId !== 'string' || !/^[A-Za-z0-9-]+$/.test(candidateId)) throw new Error('Generate a vector preview before approving artwork');
    const candidate = await prisma.semaCoreCommand.findFirst({ where: { id: candidateId, actorId: input.userId, commandType: 'vectorforge.artwork.vector-preview', status: 'SUCCESS' }, select: { subjectIds: true } });
    const subjectIds = candidate && Array.isArray(candidate.subjectIds) ? candidate.subjectIds : [];
    if (!candidate || !subjectIds.some((subjectId) => subjectId === artwork.id)) throw new Error('The selected vector preview does not belong to this artwork');
    const traceSvgPath = path.join(directory, 'vectorforge', 'vectorized', '.preview', `${candidateId}.svg`);
    const [svg, workingRaster] = await Promise.all([
      readFile(traceSvgPath, 'utf8'),
      readFile(working.filePath),
    ]);
    // Working JPG names are internal version labels. Completed outputs use the
    // permanent output base, created on intake and updated only by Rename.
    // The fallback also repairs existing records once, stripping an old edit
    // suffix instead of ever publishing it.
    const base = outputBaseName(artwork.outputBaseName)
      || outputBaseName(artwork.title)
      || outputBaseName(original?.filePath)
      || outputBaseName(working.filePath)
      || 'artwork';
    if (artwork.outputBaseName !== base) {
      await prisma.artwork.update({ where: { id: artwork.id }, data: { outputBaseName: base } });
    }
    const vectorDir = path.join(directory, 'vectorforge', 'vectorized'); const pngDir = path.join(directory, 'vectorforge', 'png'); const jpgDir = path.join(directory, 'vectorforge', 'jpg'); const manifestPath = path.join(directory, 'vectorforge', 'manifest', 'manifest.json');
    await Promise.all([mkdir(vectorDir, { recursive: true }), mkdir(pngDir, { recursive: true }), mkdir(jpgDir, { recursive: true })]);
    const svgPath = path.join(vectorDir, `${base}.svg`); const pngPath = path.join(pngDir, `${base}.png`); const jpgPath = path.join(jpgDir, `${base}.jpg`);
    await writeFile(svgPath, svg, 'utf8');
    // The working raster is the approved/editable artwork.  It is the source
    // for the delivered PNG and JPG; the SVG is a separate trace of that same
    // working image and must not replace its filled raster pixels.
    if (workingPng?.filePath) {
      await copyFile(workingPng.filePath, pngPath);
    } else {
      await createFixedCanvasRaster(workingRaster, pngPath, {
        width: 2000,
        height: 2000,
        format: 'png',
        canvasPaddingPx: settings.exportCanvasPaddingPx,
        artworkColor: rasterSettings.pngColor,
        whiteTransparencyThreshold: rasterSettings.whiteTransparencyThreshold,
      });
    }
    await createFixedCanvasRaster(workingRaster, jpgPath, {
      width: 2000,
      height: 2000,
      format: 'jpg',
      quality: 90,
      canvasPaddingPx: settings.exportCanvasPaddingPx,
      preserveRasterPixels: true,
    });
    const outputLocation = await getWritableStorageLocationForFile({ profileId: profile.id, workspaceId: artwork.workspaceId, defaultLocation, filePath: svgPath });
    const outputs = await Promise.all([
      recordApprovedOutput({ artwork, role: 'approved-svg', filePath: svgPath, mimeType: 'image/svg+xml', profileId: profile.id, storageLocationId: outputLocation.id, storageBasePath: outputLocation.basePath, reviewStatus }),
      recordApprovedOutput({ artwork, role: 'approved-png', filePath: pngPath, mimeType: 'image/png', profileId: profile.id, storageLocationId: outputLocation.id, storageBasePath: outputLocation.basePath, reviewStatus }),
      recordApprovedOutput({ artwork, role: 'approved-jpg', filePath: jpgPath, mimeType: 'image/jpeg', profileId: profile.id, storageLocationId: outputLocation.id, storageBasePath: outputLocation.basePath, reviewStatus }),
    ]);
    await writeFile(manifestPath, `${JSON.stringify({ manifestType: 'VECTORFORGE.ARTWORK', manifestVersion: 3, approvedAt: new Date().toISOString(), reviewStatus, references: { artworkId: artwork.artworkNumber, workingAssetId: working.assetId, approvedAssetIds: outputs.map(({ asset }) => asset.assetId), approvedAssetVersionIds: outputs.map(({ version }) => version.assetVersionId) }, outputs: { svg: path.relative(directory, svgPath), png: path.relative(directory, pngPath), jpg: path.relative(directory, jpgPath) }, tuning: settings }, null, 2)}\n`, 'utf8');
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
    return { svgPath, pngPath, jpgPath, reviewStatus, commandId: command.id };
  } catch (error) { await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined); throw error; }
}
