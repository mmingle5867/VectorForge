import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { getIncrementalFolderName } from '@/lib/server-utils';
import { logger } from '@/lib/logger';
import { getJpgPath, getPngPath, getSvgPath } from '@/lib/output-naming';
import { getArtworkPackageFolderName } from '@/lib/package-structure';
import { applyRasterSourcePadding } from '@/lib/raster-source-padding';
import { createFixedCanvasRaster } from '@/services/raster-export';
import { isSvgMimeOrPath } from '@/lib/svg-normalize';
import { exportImportedSvgPackage } from '@/services/svg-import-export';
import { recomputeBatchStatus } from '@/services/batch-status';
import { ensureBatchItemSemaContext } from '@/services/sema-identity';
import { resolveManagedPath } from '@/lib/path-management';
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

async function logRasterDiagnostics(filePath: string, format: 'png' | 'jpg', label: string) {
  const metadata = await sharp(filePath).metadata();
  const sizeBytes = await fileSize(filePath);
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let alphaZeroPixels = 0;
  let alphaPositivePixels = 0;
  let nonWhitePixels = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  let sampleArtworkColor: { r: number; g: number; b: number; a: number } | null = null;
  let sampleBackgroundAlpha: number | null = null;

  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];

    minAlpha = Math.min(minAlpha, a);
    maxAlpha = Math.max(maxAlpha, a);

    if (a === 0) {
      alphaZeroPixels += 1;
    } else {
      alphaPositivePixels += 1;
      if (!sampleArtworkColor && (r < 250 || g < 250 || b < 250)) {
        sampleArtworkColor = { r, g, b, a };
      }
    }

    if (sampleBackgroundAlpha === null && index === 0) {
      sampleBackgroundAlpha = a;
    }

    if ((r + g + b) / 3 < 250) {
      nonWhitePixels += 1;
    }
  }

  const diagnostics =
    format === 'png'
      ? {
          width: metadata.width,
          height: metadata.height,
          sizeBytes,
          alphaZeroPixels,
          alphaPositivePixels,
          minAlpha,
          maxAlpha,
          sampleBackgroundAlpha,
          sampleArtworkColor,
          visuallyEmpty: alphaPositivePixels === 0,
        }
      : {
          width: metadata.width,
          height: metadata.height,
          sizeBytes,
          nonWhitePixels,
          visuallyEmpty: nonWhitePixels === 0,
        };

  logger.info(`Approve-save raster output diagnostics: ${label}`, {
    filePath,
    format,
    ...diagnostics,
  });

  if (format === 'png' && alphaPositivePixels === 0) {
    logger.warn(`Approve-save raster PNG appears blank: ${label}`, {
      filePath,
      format,
      ...diagnostics,
    });
  }

  if (format === 'jpg' && nonWhitePixels === 0) {
    logger.warn(`Approve-save raster JPG appears blank: ${label}`, {
      filePath,
      format,
      ...diagnostics,
    });
  }
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function decodeApprovedSvg(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;

  const svg = Buffer.from(value, 'base64').toString('utf-8');
  return /<svg\b/i.test(svg) ? svg : null;
}

async function prepareRasterExportBuffer(
  imageBuffer: Buffer,
  originalWidth: number,
  originalHeight: number,
  upscaleFactor: 1 | 2 | 4,
  smartUpscaleThreshold: number,
  sourcePaddingPx: number,
  format: 'png' | 'jpg'
) {
  const shouldUpscale =
    upscaleFactor > 1 &&
    (originalWidth < smartUpscaleThreshold || originalHeight < smartUpscaleThreshold);
  const sourcePadding = Number.isFinite(sourcePaddingPx) ? Math.round(sourcePaddingPx) : 0;
  const padded = await applyRasterSourcePadding(
    imageBuffer,
    sourcePadding,
    format === 'png'
      ? { r: 255, g: 255, b: 255, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 }
  );

  if (shouldUpscale) {
    const resizeWidth = padded.width * upscaleFactor;
    const resizeHeight = padded.height * upscaleFactor;
    const raster = sharp(padded.buffer).resize(resizeWidth, resizeHeight, {
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    });

    return raster.png().toBuffer();
  }

  return sharp(padded.buffer).png().toBuffer();
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;
    const body = await req.json();
    const parsed = previewTuneSchema.safeParse(body);

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
    const outputBasePath = resolveManagedPath(user.settings?.outputPath || config.paths.output);
    const imageBuffer = await readFile(item.uploadPath);
    const identityContext = await ensureBatchItemSemaContext({
      batchItemId: item.id,
      batchId,
      userId: user.id,
      title: item.baseName,
      sourceFilePath: item.uploadPath,
      sourceMimeType: item.mimeType,
    });
    const identity = identityContext.artwork;
    const packageFolderName = identity.artworkNumber
      ? getArtworkPackageFolderName(identity.artworkNumber, item.baseName)
      : item.baseName;
    const outputDir = await ensureOutputDirectory(
      outputBasePath,
      packageFolderName,
      item.outputFolderPath
    );
    if (item.outputFolderPath !== outputDir) {
      await prisma.batchItem.update({
        where: { id: item.id },
        data: { outputFolderPath: outputDir },
      });
    }
    const svgPath = getSvgPath(outputDir, item.baseName);
    const pngPath = getPngPath(outputDir, item.baseName);
    const jpgPath = getJpgPath(outputDir, item.baseName);
    const svgFilename = path.basename(svgPath);
    const pngFilename = path.basename(pngPath);
    const jpgFilename = path.basename(jpgPath);

    if (isSvgMimeOrPath(item.mimeType, item.uploadPath)) {
      const originalSvg = imageBuffer.toString('utf-8');
      const svgExport = await exportImportedSvgPackage(originalSvg, outputDir, {
        pngExportArtworkColor,
        svgCanvasPaddingPx: parsed.data.svgCanvasPaddingPx,
        exportCanvasPaddingPx: parsed.data.exportCanvasPaddingPx,
        createZip: false,
        fileBaseName: item.baseName,
      });

      await prisma.batchItem.update({
        where: { id: item.id },
        data: {
          svgPath: svgExport.svgPath,
          outputFolderPath: outputDir,
          status: 'NEEDS_MANUAL_EDIT' as any,
          progress: 100,
          currentStep: null,
          errorMsg: null,
          completedAt: null,
        },
      });
      await recomputeBatchStatus(batchId);

      return NextResponse.json({
        success: true,
        message: 'Approved SVG item saved successfully',
        itemStatus: 'NEEDS_MANUAL_EDIT',
        outputFolderPath: outputDir,
        files: svgExport.files,
        warnings: ['DXF export is not yet implemented for approved preview saves.'],
      });
    }

    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    if (!originalWidth || !originalHeight) {
      return NextResponse.json(
        { success: false, error: 'Unable to read image dimensions' },
        { status: 400 }
      );
    }

    const approvedSvg = decodeApprovedSvg(body.approvedSvgBase64);
    if (approvedSvg) {
      await writeFile(svgPath, approvedSvg, 'utf-8');
    } else {
      const result = await generateTunedSvg({
        imageBuffer,
        originalWidth,
        originalHeight,
        upscaleFactor: item.upscaleFactor as 1 | 2 | 4,
        smartUpscaleThreshold: item.batch.smartUpscaleThreshold,
        cncMode,
        settings: parsed.data,
        sourceMimeType: item.mimeType,
        sourcePath: item.uploadPath,
      });

      await writeFile(svgPath, result.svg, 'utf-8');
    }
    const rasterSourcePaddingPx = parsed.data.rasterSourcePaddingPx;
    const pngRasterExportBuffer = await prepareRasterExportBuffer(
      imageBuffer,
      originalWidth,
      originalHeight,
      item.upscaleFactor as 1 | 2 | 4,
      item.batch.smartUpscaleThreshold,
      rasterSourcePaddingPx,
      'png'
    );
    const jpgRasterExportBuffer = await prepareRasterExportBuffer(
      imageBuffer,
      originalWidth,
      originalHeight,
      item.upscaleFactor as 1 | 2 | 4,
      item.batch.smartUpscaleThreshold,
      rasterSourcePaddingPx,
      'jpg'
    );

    await createFixedCanvasRaster(pngRasterExportBuffer, pngPath, {
      width: config.processing.rasterExportWidth,
      height: config.processing.rasterExportHeight,
      format: 'png',
      artworkColor: pngExportArtworkColor,
      canvasPaddingPx: parsed.data.exportCanvasPaddingPx,
      preserveRasterPixels: false,
    });
    await createFixedCanvasRaster(jpgRasterExportBuffer, jpgPath, {
      width: config.processing.rasterExportWidth,
      height: config.processing.rasterExportHeight,
      format: 'jpg',
      quality: 90,
      artworkColor: '#000000',
      canvasPaddingPx: parsed.data.exportCanvasPaddingPx,
      preserveRasterPixels: true,
    });
    await logRasterDiagnostics(pngPath, 'png', 'approve-save PNG');
    await logRasterDiagnostics(jpgPath, 'jpg', 'approve-save JPG');

    await prisma.batchItem.update({
      where: { id: item.id },
      data: {
        svgPath,
        outputFolderPath: outputDir,
        status: 'NEEDS_MANUAL_EDIT' as any,
        progress: 100,
        currentStep: null,
        errorMsg: null,
        completedAt: null,
      },
    });
    await recomputeBatchStatus(batchId);

    return NextResponse.json({
      success: true,
      message: 'Approved item saved successfully',
      itemStatus: 'NEEDS_MANUAL_EDIT',
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
