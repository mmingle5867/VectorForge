/**
 * VectorForge - Final Package Trigger API Route
 * Finalizes reviewed READY_TO_PROCESS items without rerunning tracing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import config from '@/lib/config';
import { logger } from '@/lib/logger';
import { finalizeManualEditPackage } from '@/services/package-finalization';
import { recomputeBatchStatus } from '@/services/batch-status';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await req.json();

    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'batchId is required' },
        { status: 400 }
      );
    }

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { items: { orderBy: { sequenceNumber: 'asc' } } },
    });

    if (!batch || batch.userId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Batch not found' },
        { status: 404 }
      );
    }

    const selectedItems = itemId
      ? batch.items.filter((item) => item.id === itemId)
      : batch.items.filter((item) => item.status !== 'CANCELLED');

    if (selectedItems.length === 0) {
      return NextResponse.json(
        { success: false, error: itemId ? 'Item not found' : 'Batch has no processable items' },
        { status: 404 }
      );
    }

    const notReadyItems = selectedItems.filter((item) => item.status !== 'READY_TO_PROCESS');
    if (notReadyItems.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: itemId
            ? 'Item must be Ready To Process before final package generation'
            : 'Batch Start Conversion requires every non-cancelled item to be Ready To Process',
        },
        { status: 400 }
      );
    }

    const settings = user.settings;
    const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const baseAssetsPath = settings?.baseAssetsPath || config.paths.baseAssets;
    const finalizationOptions = {
      substitutionData: (batch.substitutionData as Record<string, string>) || {},
      baseAssetsPath,
      copyBaseAssetsToOutput: (settingsJson.copyBaseAssetsToOutput as boolean) ?? false,
      enableMarketplacePreview: (settingsJson.enableMarketplacePreview as boolean) ?? true,
      enableColorTint: (settingsJson.enableColorTint as boolean) ?? false,
      tintColor: (settingsJson.tintColor as string) ?? '#FFFFFF',
      watermarkOpacity: (settingsJson.watermarkOpacity as number) ?? 80,
      backgroundFilename: (settingsJson.backgroundFilename as string) ?? 'preview-background.jpg',
      watermarkFilename: (settingsJson.watermarkFilename as string) ?? 'watermark.png',
      cncMode: (settingsJson.cncMode as boolean) ?? true,
    };

    await prisma.batch.update({
      where: { id: batchId },
      data: { status: 'PROCESSING', startedAt: new Date(), completedAt: null },
    });

    const results: Array<{ itemId: string; zipPath: string }> = [];

    for (const item of selectedItems) {
      await prisma.batchItem.update({
        where: { id: item.id },
        data: {
          status: 'PROCESSING' as any,
          progress: 25,
          currentStep: 'Generating final package...',
          errorMsg: null,
          completedAt: null,
        },
      });

      try {
        const finalization = await finalizeManualEditPackage({
          item,
          ...finalizationOptions,
        });

        await prisma.batchItem.update({
          where: { id: item.id },
          data: {
            status: 'COMPLETED',
            progress: 100,
            currentStep: null,
            errorMsg: null,
            sku: finalization.sku,
            svgPath: finalization.svgPath,
            zipPath: finalization.zipPath,
            skuFilePath: finalization.skuFilePath,
            metadataPath: finalization.metadataPath,
            previewPath: finalization.marketplacePreviewPath,
            completedAt: new Date(),
          },
        });

        results.push({ itemId: item.id, zipPath: finalization.zipPath });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await prisma.batchItem.update({
          where: { id: item.id },
          data: {
            status: 'FAILED',
            progress: 0,
            currentStep: null,
            errorMsg,
            completedAt: null,
          },
        });
        await recomputeBatchStatus(batchId);

        logger.error('Final package generation failed', {
          batchId,
          itemId: item.id,
          error: errorMsg,
        });

        return NextResponse.json(
          { success: false, error: errorMsg, failedItemId: item.id },
          { status: 500 }
        );
      }
    }

    const batchStatus = await recomputeBatchStatus(batchId);

    logger.info(`Final package generation completed for batch ${batchId}`, {
      batchId,
      itemCount: results.length,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      message: `Final package generated for ${results.length} item${results.length === 1 ? '' : 's'}`,
      batchId,
      itemCount: results.length,
      batchStatus: batchStatus.status,
      results,
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
