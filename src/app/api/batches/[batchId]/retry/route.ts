import { NextRequest, NextResponse } from 'next/server';
import { access } from 'fs/promises';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { recomputeBatchStatus } from '@/services/batch-status';

async function fileExists(filePath: string | null | undefined) {
  if (!filePath) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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

    const failedItems = batch.items.filter((item) => item.status === 'FAILED');
    if (failedItems.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Batch has no failed items to retry' },
        { status: 400 }
      );
    }

    let needsManualEditCount = 0;
    let pendingCount = 0;

    for (const item of failedItems) {
      const hasBaseOutput = await fileExists(item.svgPath) || !!item.outputFolderPath;
      const nextStatus = hasBaseOutput ? 'NEEDS_MANUAL_EDIT' : 'PENDING';
      if (nextStatus === 'NEEDS_MANUAL_EDIT') {
        needsManualEditCount += 1;
      } else {
        pendingCount += 1;
      }

      await prisma.batchItem.update({
        where: { id: item.id },
        data: {
          status: nextStatus as any,
          progress: hasBaseOutput ? 100 : 0,
          currentStep: null,
          errorMsg: null,
          completedAt: null,
        },
      });
    }

    const nextBatch = await recomputeBatchStatus(batchId);

    logger.info(`Failed batch ${batchId} reset`, {
      batchId,
      itemCount: failedItems.length,
      userId: user.id,
      needsManualEditCount,
      pendingCount,
    });

    return NextResponse.json({
      success: true,
      message: `${failedItems.length} failed item${failedItems.length === 1 ? '' : 's'} reset`,
      resetItems: failedItems.length,
      needsManualEditCount,
      pendingCount,
      batchStatus: nextBatch.status,
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
