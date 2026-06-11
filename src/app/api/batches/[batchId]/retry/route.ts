import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import { enqueueProcessingJob } from '@/lib/queue';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId } = await params;

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          orderBy: { sequenceNumber: 'asc' },
        },
      },
    });

    if (!batch || batch.userId !== user.id) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (batch.status !== 'FAILED') {
      return NextResponse.json(
        { success: false, error: 'Only failed batches can be retried' },
        { status: 400 }
      );
    }

    const failedItems = batch.items.filter((item) => item.status === 'FAILED');
    if (failedItems.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Batch has no failed items to retry' },
        { status: 400 }
      );
    }

    const missingUploads = failedItems.filter((item) => !item.uploadPath);
    if (missingUploads.length > 0) {
      return NextResponse.json(
        { success: false, error: 'One or more failed items no longer have an upload file path' },
        { status: 400 }
      );
    }

    const settings = user.settings;
    const outputBasePath = settings?.outputPath || config.paths.output;
    const baseAssetsPath = settings?.baseAssetsPath || config.paths.baseAssets;
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
    const completedItems = batch.items.filter((item) => item.status === 'COMPLETED').length;

    await prisma.$transaction([
      prisma.batchItem.updateMany({
        where: {
          batchId,
          status: 'FAILED',
        },
        data: {
          status: 'PENDING',
          progress: 0,
          currentStep: null,
          errorMsg: null,
          completedAt: null,
        },
      }),
      prisma.batch.update({
        where: { id: batchId },
        data: {
          status: 'PROCESSING',
          completedItems,
          failedItems: 0,
          startedAt: new Date(),
          completedAt: null,
        },
      }),
    ]);

    for (const item of failedItems) {
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
        enableMarketplacePreview,
        enableColorTint,
        tintColor,
        watermarkOpacity,
        backgroundFilename,
        watermarkFilename,
        pngExportArtworkColor,
        cncMode,
      });
    }

    logger.info(`Retry started for failed batch ${batchId}`, {
      batchId,
      itemCount: failedItems.length,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      message: `Retry started for ${failedItems.length} failed item${failedItems.length === 1 ? '' : 's'}`,
      resetItems: failedItems.length,
      batchStatus: 'PROCESSING',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Retry batch error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to retry batch' },
      { status: 500 }
    );
  }
}
