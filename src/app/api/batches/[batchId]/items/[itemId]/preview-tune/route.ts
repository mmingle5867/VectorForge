import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  generateTunedSvg,
  getPreviewValidationError,
  getSvgDiagnostics,
  previewTuneSchema,
} from '@/services/tuned-svg';
import { isSvgMimeOrPath, normalizeImportedSvg } from '@/lib/svg-normalize';

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
        { success: false, error: 'No file available for preview' },
        { status: 404 }
      );
    }

    const userSettings = (user.settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const cncMode = (userSettings.cncMode as boolean) ?? true;
    const startTime = Date.now();
    const imageBuffer = await readFile(item.uploadPath);

    if (isSvgMimeOrPath(item.mimeType, item.uploadPath)) {
      const normalized = normalizeImportedSvg(imageBuffer.toString('utf-8'));
      const debugDir = path.join(process.cwd(), 'logs');
      const debugSvgPath = path.join(debugDir, `debug-preview-${item.id}.svg`);
      await mkdir(debugDir, { recursive: true });
      await writeFile(debugSvgPath, normalized.svg, 'utf-8');

      return NextResponse.json({
        success: true,
        preview: {
          itemId: item.id,
          filename: item.originalFilename,
          originalWidth: normalized.width,
          originalHeight: normalized.height,
          traceWidth: normalized.width,
          traceHeight: normalized.height,
          upscaleApplied: false,
          upscaleFactor: 1,
          svgSize: Buffer.byteLength(normalized.svg, 'utf-8'),
          svgBase64: Buffer.from(normalized.svg).toString('base64'),
          debugSvgPath,
          diagnostics: getSvgDiagnostics(normalized.svg),
          processingTimeMs: Date.now() - startTime,
        },
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

    const result = await generateTunedSvg({
      imageBuffer,
      originalWidth,
      originalHeight,
      upscaleFactor: item.upscaleFactor as 1 | 2 | 4,
      smartUpscaleThreshold: item.batch.smartUpscaleThreshold,
      cncMode,
      settings: parsed.data,
    });

    const debugDir = path.join(process.cwd(), 'logs');
    const debugSvgPath = path.join(debugDir, `debug-preview-${item.id}.svg`);
    await mkdir(debugDir, { recursive: true });
    await writeFile(debugSvgPath, result.svg, 'utf-8');

    return NextResponse.json({
      success: true,
      preview: {
        itemId: item.id,
        filename: item.originalFilename,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
        traceWidth: result.traceWidth,
        traceHeight: result.traceHeight,
        upscaleApplied: result.upscaleApplied,
        upscaleFactor: result.upscaleFactor,
        svgSize: result.svgSize,
        svgBase64: Buffer.from(result.svg).toString('base64'),
        debugSvgPath,
        diagnostics: result.diagnostics,
        processingTimeMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    logger.error('Preview tune error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}
