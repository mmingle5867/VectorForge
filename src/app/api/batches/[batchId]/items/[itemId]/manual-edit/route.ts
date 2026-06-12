import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { recomputeBatchStatus } from '@/services/batch-status';
import { finalizeManualEditPackage } from '@/services/package-finalization';
import config from '@/lib/config';

type ManualEditAction = 'needs_manual_edit' | 'complete';

function getAction(value: unknown): ManualEditAction | null {
  return value === 'needs_manual_edit' || value === 'complete' ? value : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;
    const body = await req.json().catch(() => ({}));
    const action = getAction(body.action);

    if (!action) {
      return NextResponse.json(
        { success: false, error: 'action must be needs_manual_edit or complete' },
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

    if (item.batch.status === 'PROCESSING') {
      return NextResponse.json(
        { success: false, error: 'Wait for processing to finish before changing manual edit status' },
        { status: 400 }
      );
    }

    let zipPath = item.zipPath;

    if (action === 'complete') {
      if (!item.outputFolderPath) {
        return NextResponse.json(
          { success: false, error: 'No output folder is available for this item' },
          { status: 400 }
        );
      }

      const settings = user.settings;
      const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
      const baseAssetsPath = settings?.baseAssetsPath || config.paths.baseAssets;
      const finalization = await finalizeManualEditPackage({
        item,
        substitutionData: (item.batch.substitutionData as Record<string, string>) || {},
        baseAssetsPath,
        copyBaseAssetsToOutput: (settingsJson.copyBaseAssetsToOutput as boolean) ?? false,
        enableMarketplacePreview: (settingsJson.enableMarketplacePreview as boolean) ?? true,
        enableColorTint: (settingsJson.enableColorTint as boolean) ?? false,
        tintColor: (settingsJson.tintColor as string) ?? '#FFFFFF',
        watermarkOpacity: (settingsJson.watermarkOpacity as number) ?? 80,
        backgroundFilename: (settingsJson.backgroundFilename as string) ?? 'preview-background.jpg',
        watermarkFilename: (settingsJson.watermarkFilename as string) ?? 'watermark.png',
        cncMode: (settingsJson.cncMode as boolean) ?? true,
      });
      zipPath = finalization.zipPath;

      await prisma.batchItem.update({
        where: { id: item.id },
        data: {
          status: 'COMPLETED' as any,
          progress: 100,
          currentStep: null,
          errorMsg: null,
          sku: finalization.sku,
          svgPath: finalization.svgPath,
          zipPath,
          skuFilePath: finalization.skuFilePath,
          metadataPath: finalization.metadataPath,
          previewPath: finalization.marketplacePreviewPath,
          completedAt: new Date(),
        },
      });
    } else {
      await prisma.batchItem.update({
        where: { id: item.id },
        data: {
          status: 'NEEDS_MANUAL_EDIT' as any,
          progress: 100,
          currentStep: null,
          errorMsg: null,
          completedAt: null,
        },
      });
    }

    const batch = await recomputeBatchStatus(batchId);

    logger.info(`Manual edit status updated for item ${itemId}`, {
      batchId,
      itemId,
      action,
      itemStatus: action === 'complete' ? 'COMPLETED' : 'NEEDS_MANUAL_EDIT',
      batchStatus: batch.status,
    });

    return NextResponse.json({
      success: true,
      itemStatus: action === 'complete' ? 'COMPLETED' : 'NEEDS_MANUAL_EDIT',
      batchStatus: batch.status,
      zipPath,
      completedItems: batch.completedItems,
      failedItems: batch.failedItems,
      needsManualEditItems: batch.needsManualEditItems,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    logger.error('Manual edit status error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update manual edit status' },
      { status: 500 }
    );
  }
}
