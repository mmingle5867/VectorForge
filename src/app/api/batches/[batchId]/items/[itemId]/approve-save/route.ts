import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { getIncrementalFolderName } from '@/lib/server-utils';
import { logger } from '@/lib/logger';
import { createFixedCanvasRaster } from '@/services/raster-export';
import {
  generateTunedSvg,
  getPreviewValidationError,
  previewTuneSchema,
} from '@/services/tuned-svg';

async function ensureOutputDirectory(basePath: string, baseName: string, existingPath?: string | null) {
  if (existingPath) {
    await mkdir(existingPath, { recursive: true });
    return existingPath;
  }

  await mkdir(basePath, { recursive: true });
  const folderName = await getIncrementalFolderName(basePath, baseName);
  const outputDir = path.join(basePath, folderName);
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

async function fileSize(filePath: string) {
  const stats = await stat(filePath);
  return stats.size;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;
    const parsed = previewTuneSchema.safeParse(await req.json());

    if (!parsed.success) {
      const { message, field, allowedRange } = getPreviewValidationError(parsed.error);

      return NextResponse.json(
        {
          success: false,
          message,
          error: message,
          field,
          allowedRange,
        },
        { status: 400 }
      );
    }

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item || item.batchId !== batchId || item.batch.userId !== user.id) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (!item.uploadPath) {
      return NextResponse.json(
        { success: false, error: 'No file available for export' },
        { status: 404 }
      );
    }

    const settingsJson = (user.settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const cncMode = (settingsJson.cncMode as boolean) ?? true;
    const pngExportArtworkColor = isHexColor(settingsJson.pngExportArtworkColor)
      ? settingsJson.pngExportArtworkColor
      : isHexColor(config.processing.pngExportArtworkColor)
        ? config.processing.pngExportArtworkColor
        : '#000000';
    const outputBasePath = user.settings?.outputPath || config.paths.output;
    const imageBuffer = await readFile(item.uploadPath);
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    if (!originalWidth || !originalHeight) {
      return NextResponse.json(
        { success: false, error: 'Unable to read image dimensions' },
        { status: 400 }
      );
    }

    const outputDir = await ensureOutputDirectory(outputBasePath, item.baseName, item.outputFolderPath);
    const result = await generateTunedSvg({
      imageBuffer,
      originalWidth,
      originalHeight,
      upscaleFactor: item.upscaleFactor as 1 | 2 | 4,
      smartUpscaleThreshold: item.batch.smartUpscaleThreshold,
      cncMode,
      settings: parsed.data,
    });

    const svgFilename = `${item.baseName}.svg`;
    const pngFilename = `${item.baseName}.png`;
    const jpgFilename = `${item.baseName}.jpg`;
    const svgPath = path.join(outputDir, svgFilename);
    const pngPath = path.join(outputDir, pngFilename);
    const jpgPath = path.join(outputDir, jpgFilename);

    await writeFile(svgPath, result.svg, 'utf-8');
    await createFixedCanvasRaster(imageBuffer, pngPath, {
      width: config.processing.rasterExportWidth,
      height: config.processing.rasterExportHeight,
      format: 'png',
      artworkColor: pngExportArtworkColor,
    });
    await createFixedCanvasRaster(imageBuffer, jpgPath, {
      width: config.processing.rasterExportWidth,
      height: config.processing.rasterExportHeight,
      format: 'jpg',
      quality: 90,
    });

    await prisma.batchItem.update({
      where: { id: item.id },
      data: {
        svgPath,
        outputFolderPath: outputDir,
        status: 'COMPLETED',
        progress: 100,
        currentStep: null,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Approved item saved successfully',
      outputFolderPath: outputDir,
      files: [
        { type: 'svg', filename: svgFilename, path: svgPath, size: await fileSize(svgPath) },
        { type: 'png', filename: pngFilename, path: pngPath, size: await fileSize(pngPath) },
        { type: 'jpg', filename: jpgFilename, path: jpgPath, size: await fileSize(jpgPath) },
      ],
      warnings: ['DXF export is not yet implemented for approved preview saves.'],
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    logger.error('Approve/save item error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: 'Failed to approve and save item' },
      { status: 500 }
    );
  }
}
