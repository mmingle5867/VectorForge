import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import prisma from '@/lib/prisma';
import { ingestStagedFiles } from '@/services/artwork-ingest';
import { ingestArtworkDirect } from '@/services/artwork-direct-ingest';
import { renameArtwork } from '@/services/artwork-rename';
import { renameDirectArtwork } from '@/services/direct-artwork-actions';

/**
 * Creates child artwork as managed copies of one composite working raster.
 * Cropping is deliberately manual: each copy is independent and opens in the
 * raster editor. Split does not create a bundle or parent relationship.
 */
export async function splitArtwork(input: {
  userId: string;
  batchItemId: string;
  childNames: string[];
}) {
  const enteredNames = input.childNames.map((name) => name.trim());
  const primaryName = enteredNames[0] ?? '';
  const additionalNames = enteredNames.slice(1).filter(Boolean);
  if (!primaryName || enteredNames.length > 24) throw new Error('Artwork 1 must have a name; create at most 24 artwork entries');

  let parent = await prisma.batchItem.findFirst({
    where: { id: input.batchItemId, batch: { userId: input.userId } },
    select: { id: true, uploadPath: true, originalFilename: true, mimeType: true },
  });
  if (!parent?.uploadPath) throw new Error('The source artwork has no managed working raster');

  const currentBaseName = path.parse(parent.originalFilename).name;
  const requestedPrimaryBaseName = path.parse(primaryName).name.trim();
  let renamed = false;
  if (requestedPrimaryBaseName && requestedPrimaryBaseName.toLocaleLowerCase() !== currentBaseName.toLocaleLowerCase()) {
    await renameArtwork({ userId: input.userId, batchItemId: parent.id, newBaseName: requestedPrimaryBaseName });
    parent = await prisma.batchItem.findFirst({
      where: { id: input.batchItemId, batch: { userId: input.userId } },
      select: { id: true, uploadPath: true, originalFilename: true, mimeType: true },
    });
    if (!parent?.uploadPath) throw new Error('Renamed source artwork could not be found');
    renamed = true;
  }

  if (additionalNames.length === 0) return { files: [], renamed };

  const sourceWorkingPath = parent.uploadPath;
  const extension = path.extname(parent.originalFilename) || '.png';
  const staging = await mkdtemp(path.join(os.tmpdir(), 'vectorforge-split-'));
  try {
    const files = await Promise.all(additionalNames.map(async (name, index) => {
      const filename = path.extname(name) ? name : `${name}${extension}`;
      const stagedPath = path.join(staging, `${index}-${filename}`);
      await copyFile(sourceWorkingPath, stagedPath);
      return { stagedPath, originalFilename: filename, mimeType: parent.mimeType };
    }));
    const ingested = await ingestStagedFiles({ userId: input.userId, files });
    if (ingested.errors.length || ingested.files.length !== additionalNames.length) {
      throw new Error(ingested.errors[0]?.error || 'Unable to create all extracted artwork');
    }
    return { files: ingested.files, renamed };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Creates independent direct-artwork copies from an immutable original.  The
 * first name represents the existing artwork; each later name becomes a new
 * artwork.  No bundle, parent relationship, or shared workflow record is
 * created.
 */
export async function splitDirectArtwork(input: {
  userId: string;
  artworkId: string;
  childNames: string[];
}) {
  const enteredNames = input.childNames.map((name) => name.trim());
  const primaryName = enteredNames[0] ?? '';
  const additionalNames = enteredNames.slice(1).filter(Boolean);
  if (!primaryName || enteredNames.length > 24) {
    throw new Error('Artwork 1 must have a name; create at most 24 artwork entries');
  }

  let source = await prisma.artwork.findFirst({
    where: { id: input.artworkId, userId: input.userId, status: 'ACTIVE', batchItems: { none: {} } },
    include: { assets: { where: { role: { in: ['original-file', 'source-file'] } } } },
  });
  if (!source) throw new Error('Artwork was not found');

  const requestedPrimaryBaseName = path.parse(primaryName).name.trim();
  let renamed = false;
  if (requestedPrimaryBaseName && requestedPrimaryBaseName.toLocaleLowerCase() !== source.title.toLocaleLowerCase()) {
    await renameDirectArtwork({ userId: input.userId, artworkId: source.id, newBaseName: requestedPrimaryBaseName });
    source = await prisma.artwork.findFirst({
      where: { id: input.artworkId, userId: input.userId, status: 'ACTIVE', batchItems: { none: {} } },
      include: { assets: { where: { role: { in: ['original-file', 'source-file'] } } } },
    });
    if (!source) throw new Error('Renamed source artwork could not be found');
    renamed = true;
  }

  if (!additionalNames.length) return { files: [], renamed };

  // Every new artwork begins from the preserved original, never a previously
  // edited JPG/PNG or vector output from the existing artwork.
  const original = source.assets.find((asset) => asset.role === 'original-file')
    ?? source.assets.find((asset) => asset.role === 'source-file');
  if (!original?.filePath) throw new Error('The source artwork has no readable original image');

  const extension = path.extname(original.filePath) || '.png';
  const staging = await mkdtemp(path.join(os.tmpdir(), 'vectorforge-direct-split-'));
  try {
    const files = await Promise.all(additionalNames.map(async (name, index) => {
      const requestedBaseName = path.parse(name).name.trim();
      if (!requestedBaseName) throw new Error(`Artwork ${index + 2} must have a name or be removed`);
      const stagedPath = path.join(staging, `${index}${extension}`);
      await copyFile(original.filePath!, stagedPath);
      return {
        stagedPath,
        originalFilename: `${requestedBaseName}${extension}`,
        mimeType: original.mimeType,
      };
    }));
    const ingested = await ingestArtworkDirect({ userId: input.userId, files });
    if (ingested.errors.length || ingested.files.length !== additionalNames.length) {
      throw new Error(ingested.errors[0]?.error || 'Unable to create all extracted artwork');
    }
    return { files: ingested.files, renamed };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
