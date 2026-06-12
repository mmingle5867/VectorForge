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
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item || item.batchId !== batchId || item.batch.userId !== user.id) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (item.status !== 'FAILED') {
      return NextResponse.json(
        { success: false, error: 'Only failed items can be retried' },
        { status: 400 }
      );
    }

    const hasBaseOutput = await fileExists(item.svgPath) || !!item.outputFolderPath;
    const nextStatus = hasBaseOutput ? 'NEEDS_MANUAL_EDIT' : 'PENDING';

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

    const batch = await recomputeBatchStatus(batchId);

    logger.info(`Failed item ${itemId} reset to ${nextStatus}`, {
      batchId,
      itemId,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      message: `${item.baseName} reset to ${nextStatus === 'NEEDS_MANUAL_EDIT' ? 'Needs Manual Edit' : 'Pending'}`,
      itemStatus: nextStatus,
      resetItems: 1,
      batchStatus: batch.status,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Retry item error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to retry item' },
      { status: 500 }
    );
  }
}
