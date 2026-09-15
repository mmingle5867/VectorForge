import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import prisma from '@/lib/prisma';
import { semaLocalToken } from '@/lib/sema-id';
import { createAssetVersion } from '@/services/asset-versions';
import { ensureDirectWorkingJpeg } from '@/services/direct-working-raster';
import { getWritableStorageLocationForFile, MAX_RASTER_EDITOR_PIXELS } from '@/services/raster-editor-preparation';
import { configureDefaultImportStorageForUser } from '@/services/profile-storage';
import { createCoreCommand } from '@/services/sema-core';

export type CanvasAnchor =
  | 'TOP_LEFT' | 'TOP' | 'TOP_RIGHT'
  | 'LEFT' | 'CENTER' | 'RIGHT'
  | 'BOTTOM_LEFT' | 'BOTTOM' | 'BOTTOM_RIGHT';

export type RasterLayout = {
  blur: number;
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  anchor: CanvasAnchor;
  fill: 'WHITE' | 'BLACK';
  dpi: number;
};

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function anchoredOffset(container: number, content: number, alignment: 'START' | 'CENTER' | 'END') {
  return alignment === 'START' ? 0 : alignment === 'END' ? container - content : Math.round((container - content) / 2);
}

function anchorOffsets(anchor: CanvasAnchor, canvasWidth: number, canvasHeight: number, imageWidth: number, imageHeight: number) {
  const horizontal = anchor.endsWith('LEFT') || anchor === 'LEFT' ? 'START' : anchor.endsWith('RIGHT') || anchor === 'RIGHT' ? 'END' : 'CENTER';
  const vertical = anchor.startsWith('TOP') || anchor === 'TOP' ? 'START' : anchor.startsWith('BOTTOM') || anchor === 'BOTTOM' ? 'END' : 'CENTER';
  return { left: anchoredOffset(canvasWidth, imageWidth, horizontal), top: anchoredOffset(canvasHeight, imageHeight, vertical) };
}

function storageRoot(settings: unknown) {
  const value = asRecord(settings).storageRootPath;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function validate(layout: RasterLayout) {
  const sizes = [layout.imageWidth, layout.imageHeight, layout.canvasWidth, layout.canvasHeight];
  if (!sizes.every((value) => Number.isInteger(value) && value > 0)) throw new Error('Image and canvas dimensions must be whole positive pixels');
  if (layout.imageWidth * layout.imageHeight > MAX_RASTER_EDITOR_PIXELS) throw new Error('Resized image exceeds the 64 MP preparation limit');
  if (layout.canvasWidth * layout.canvasHeight > MAX_RASTER_EDITOR_PIXELS) throw new Error('Canvas exceeds the 64 MP preparation limit');
  if (!Number.isFinite(layout.blur) || layout.blur < 0 || layout.blur > 20) throw new Error('Blur must be between 0 and 20');
  if (!Number.isFinite(layout.dpi) || layout.dpi < 1 || layout.dpi > 2400) throw new Error('DPI must be between 1 and 2400');
}

/** Creates one immutable working JPG version with image scaling, canvas placement, and optional blur. */
export async function prepareDirectRasterLayout(input: { userId: string; artworkId: string; layout: RasterLayout }) {
  validate(input.layout);
  await ensureDirectWorkingJpeg({ userId: input.userId, artworkId: input.artworkId });
  const artwork = await prisma.artwork.findFirst({
    where: { id: input.artworkId, userId: input.userId, status: 'ACTIVE', batchItems: { none: {} } },
    include: { assets: { where: { role: 'source-file', status: 'ACTIVE' }, include: { versions: true }, take: 1 } },
  });
  const source = artwork?.assets[0];
  if (!artwork || !source?.filePath) throw new Error('Working JPG was not found');
  const user = await prisma.user.findUnique({ where: { id: input.userId }, include: { settings: true } });
  if (!user) throw new Error('User was not found');

  const auditLayout: Prisma.InputJsonObject = {
    blur: input.layout.blur, imageWidth: input.layout.imageWidth, imageHeight: input.layout.imageHeight,
    canvasWidth: input.layout.canvasWidth, canvasHeight: input.layout.canvasHeight,
    anchor: input.layout.anchor, fill: input.layout.fill, dpi: input.layout.dpi,
  };
  const nextVersion = Math.max(0, ...source.versions.map((version) => version.versionNumber)) + 1;
  const parsed = path.parse(source.filePath);
  const target = path.join(path.dirname(source.filePath), `${parsed.name}-edit-v${String(nextVersion).padStart(4, '0')}.jpg`);
  const command = await createCoreCommand({
    commandType: 'vectorforge.raster.prepare-layout',
    actorId: input.userId,
    workspaceId: artwork.workspaceId,
    subjectIds: [artwork.id, source.id],
    payload: { layout: auditLayout },
  });
  const temporary = path.join(path.dirname(target), `.vf-${semaLocalToken(command.id)}.jpg`);
  const { left, top } = anchorOffsets(input.layout.anchor, input.layout.canvasWidth, input.layout.canvasHeight, input.layout.imageWidth, input.layout.imageHeight);

  try {
    let image = sharp(source.filePath).resize(input.layout.imageWidth, input.layout.imageHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
    if (input.layout.blur >= 0.3) image = image.blur(input.layout.blur);
    const resized = await image.jpeg({ quality: 95 }).toBuffer();
    // Sharp composites must start inside the destination canvas. Crop the
    // resized image explicitly when the requested canvas clips it.
    const sourceLeft = Math.max(0, -left);
    const sourceTop = Math.max(0, -top);
    const compositeLeft = Math.max(0, left);
    const compositeTop = Math.max(0, top);
    const compositeWidth = Math.min(input.layout.imageWidth - sourceLeft, input.layout.canvasWidth - compositeLeft);
    const compositeHeight = Math.min(input.layout.imageHeight - sourceTop, input.layout.canvasHeight - compositeTop);
    const placed = await sharp(resized)
      .extract({ left: sourceLeft, top: sourceTop, width: compositeWidth, height: compositeHeight })
      .toBuffer();
    await sharp({
      create: {
        width: input.layout.canvasWidth,
        height: input.layout.canvasHeight,
        channels: 3,
        background: input.layout.fill === 'BLACK' ? '#000000' : '#ffffff',
      },
    })
      .composite([{ input: placed, left: compositeLeft, top: compositeTop }])
      .jpeg({ quality: 95 })
      .withMetadata({ density: input.layout.dpi })
      .toFile(temporary);
    await rename(temporary, target);

    const storage = await configureDefaultImportStorageForUser({ userId: input.userId, storageRootPath: storageRoot(user.settings?.defaultSubstitutions) });
    const contents = await readFile(target);
    const location = await getWritableStorageLocationForFile({ profileId: storage.profile.id, workspaceId: artwork.workspaceId, defaultLocation: storage.location, filePath: target });
    const metadata: Prisma.InputJsonObject = {
      role: 'raster-layout-working-copy',
      derivedFromPath: source.filePath,
      layout: auditLayout,
      imageOffset: { left, top },
    };
    const version = await createAssetVersion({
      assetId: source.id, createdByProfileId: storage.profile.id, storageLocationId: location.id,
      relativePath: path.relative(location.basePath, target).split(path.sep).join('/'),
      sha256: createHash('sha256').update(contents).digest('hex'), byteLength: contents.byteLength,
      mimeType: 'image/jpeg', status: 'DRAFT', verifiedAt: new Date(), metadata,
    });
    const sourceMetadata = asRecord(source.metadata);
    await prisma.$transaction([
      prisma.asset.update({ where: { id: source.id }, data: { filePath: target, mimeType: 'image/jpeg', metadata: { ...sourceMetadata, workingFormat: 'JPEG', jpegReadyForVectorizing: false } } }),
      prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } }),
    ]);
    return { filePath: target, assetVersionId: version.assetVersionId, imageOffset: { left, top } };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined);
    throw error;
  }
}
