import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import prisma from '@/lib/prisma';
import { getManagedArtworkDirectory } from '@/lib/artwork-storage-paths';
import { renderFixedCanvasSvgRaster } from '@/services/raster-export';
import { createCoreCommand } from '@/services/sema-core';
import { generateTunedSvg, previewTuneSchema } from '@/services/tuned-svg';

const MAX_VECTOR_PREVIEW_PIXELS = 64_000_000;

function candidatePath(directory: string, candidateId: string) {
  if (!/^[A-Za-z0-9-]+$/.test(candidateId)) throw new Error('Invalid vector preview identifier');
  return path.join(directory, 'vectorforge', 'vectorized', '.preview', `${candidateId}.svg`);
}

async function ownedWorkingArtwork(userId: string, artworkId: string) {
  const artwork = await prisma.artwork.findFirst({
    where: { id: artworkId, userId, status: 'ACTIVE', batchItems: { none: {} } },
    include: { assets: true },
  });
  const working = artwork?.assets.find((asset) => asset.role === 'source-file');
  if (!artwork || !working?.filePath) throw new Error('Artwork working copy was not found');
  const directory = getManagedArtworkDirectory(working.filePath);
  if (!directory) throw new Error('Artwork has no managed directory');
  return { artwork, working, directory };
}

export async function generateDirectArtworkVectorPreview(input: {
  userId: string;
  artworkId: string;
  settings: unknown;
  upscaleFactor?: number;
}) {
  const { artwork, working, directory } = await ownedWorkingArtwork(input.userId, input.artworkId);
  const settings = previewTuneSchema.parse(input.settings);
  const upscaleFactor = input.upscaleFactor ?? 1;
  if (!Number.isInteger(upscaleFactor) || upscaleFactor < 1 || upscaleFactor > 10) throw new Error('Upscale factor must be a whole number from 1× through 10×');
  const command = await createCoreCommand({
    commandType: 'vectorforge.artwork.vector-preview',
    actorId: input.userId,
    workspaceId: artwork.workspaceId,
    subjectIds: [artwork.id, working.id],
    payload: { settings, upscaleFactor },
  });
  try {
    const source = await readFile(working.filePath!);
    const meta = await sharp(source).metadata();
    if (!meta.width || !meta.height) throw new Error('Unable to read artwork dimensions');
    const outputPixels = meta.width * upscaleFactor * meta.height * upscaleFactor;
    if (outputPixels > MAX_VECTOR_PREVIEW_PIXELS) {
      throw new Error(`Vector preview would be ${(meta.width * upscaleFactor).toLocaleString()} × ${(meta.height * upscaleFactor).toLocaleString()} pixels (${(outputPixels / 1_000_000).toFixed(1)} MP). The limit is 64 MP. Choose a smaller upscale factor.`);
    }
    const trace = await generateTunedSvg({
      imageBuffer: source,
      originalWidth: meta.width,
      originalHeight: meta.height,
      upscaleFactor,
      // The direct Preview/Tune slider is an explicit user decision, so it
      // must not be silently overridden by the automatic small-image heuristic.
      smartUpscaleThreshold: Number.MAX_SAFE_INTEGER,
      cncMode: false,
      settings,
      sourceMimeType: working.mimeType,
      sourcePath: working.filePath,
    });
    const filePath = candidatePath(directory, command.id);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, trace.svg, 'utf8');
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
    return { candidateId: command.id, diagnostics: trace.diagnostics, traceWidth: trace.traceWidth, traceHeight: trace.traceHeight };
  } catch (error) {
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined);
    throw error;
  }
}

export async function readDirectArtworkVectorPreview(input: { userId: string; artworkId: string; candidateId: string }) {
  const { directory } = await ownedWorkingArtwork(input.userId, input.artworkId);
  const candidate = await prisma.semaCoreCommand.findFirst({
    where: { id: input.candidateId, actorId: input.userId, commandType: 'vectorforge.artwork.vector-preview', status: 'SUCCESS' },
    select: { subjectIds: true },
  });
  const subjectIds = candidate && Array.isArray(candidate.subjectIds) ? candidate.subjectIds : [];
  if (!candidate || !subjectIds.some((subjectId) => subjectId === input.artworkId)) throw new Error('Vector preview was not found for this artwork');
  return readFile(candidatePath(directory, input.candidateId), 'utf8');
}

/**
 * Render a temporary inspection image from the exact SVG candidate. This does
 * not create an Asset, AssetVersion, approved output, or manifest entry.
 */
export async function renderDirectArtworkVectorPreview(input: {
  userId: string;
  artworkId: string;
  candidateId: string;
  format: 'png' | 'jpg';
  preserveColors?: boolean;
}) {
  const svg = await readDirectArtworkVectorPreview(input);
  return renderFixedCanvasSvgRaster(Buffer.from(svg, 'utf8'), {
    width: 2000,
    height: 2000,
    format: input.format,
    quality: 90,
    artworkColor: '#000000',
    canvasPaddingPx: 0,
    preserveColors: input.preserveColors === true,
  });
}
