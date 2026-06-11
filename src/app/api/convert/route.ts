/**
 * VectorForge - Conversion Trigger API Route
 * Starts the background processing pipeline for a batch.
 * Enqueues all batch items into the BullMQ processing queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { enqueueProcessingJob } from '@/lib/queue';
import config from '@/lib/config';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { batchId } = await req.json();

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'batchId is required' },
        { status: 400 }
      );
    }

    // Verify batch ownership and status
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });

    if (!batch || batch.userId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    if (batch.status !== 'PENDING') {
      return NextResponse.json(
        { success: false, error: 'Batch has already been started or completed' },
        { status: 400 }
      );
    }

    if (batch.items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Batch has no items to process' },
        { status: 400 }
      );
    }

    // Get user settings for paths and preview options
    const settings = user.settings;
    const outputBasePath = settings?.outputPath || config.paths.output;
    const baseAssetsPath = settings?.baseAssetsPath || config.paths.baseAssets;

    // Parse extended settings from JSON (stored in defaultSubstitutions or separate fields)
    const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const enableMarketplacePreview = (settingsJson.enableMarketplacePreview as boolean) ?? true;
    const enableColorTint = (settingsJson.enableColorTint as boolean) ?? false;
    const tintColor = (settingsJson.tintColor as string) ?? '#FFFFFF';
    const watermarkOpacity = (settingsJson.watermarkOpacity as number) ?? 80;
    const backgroundFilename = (settingsJson.backgroundFilename as string) ?? 'preview-background.jpg';
    const watermarkFilename = (settingsJson.watermarkFilename as string) ?? 'watermark.png';
    const copyBaseAssetsToOutput = (settingsJson.copyBaseAssetsToOutput as boolean) ?? false;
    const pngExportArtworkColor = (settingsJson.pngExportArtworkColor as string) ?? config.processing.pngExportArtworkColor;
    const cncMode = (settingsJson.cncMode as boolean) ?? true;

    // Update batch status to PROCESSING
    await prisma.batch.update({
      where: { id: batchId },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
      },
    });

    // Enqueue each item for processing
    for (const item of batch.items) {
      await enqueueProcessingJob({
        batchId: batch.id,
        batchItemId: item.id,
        userId: user.id,
        originalFilename: item.originalFilename,
        baseName: item.baseName,
        uploadPath: item.uploadPath || '',
        mimeType: item.mimeType,
        upscaleFactor: item.upscaleFactor,
        smartUpscaleThreshold: batch.smartUpscaleThreshold,
        useBaseAssets: copyBaseAssetsToOutput,
        substitutionData: (batch.substitutionData as Record<string, string>) || {},
        outputBasePath,
        baseAssetsPath,
        // Marketplace Preview options
        enableMarketplacePreview,
        enableColorTint,
        tintColor,
        watermarkOpacity,
        backgroundFilename,
        watermarkFilename,
        pngExportArtworkColor,
        // CNC Mode
        cncMode,
      });
    }

    logger.info(`Conversion started for batch ${batchId}`, {
      batchId,
      itemCount: batch.items.length,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      message: `Processing started for ${batch.items.length} items`,
      batchId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Convert: Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
