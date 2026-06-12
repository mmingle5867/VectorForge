import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { recomputeBatchStatus } from '@/services/batch-status';

type ManualEditAction = 'needs_manual_edit' | 'ready_to_process';

function getAction(value: unknown): ManualEditAction | null {
  return value === 'needs_manual_edit' || value === 'ready_to_process' ? value : null;
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
        { success: false, error: 'action must be needs_manual_edit or ready_to_process' },
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

    if (item.status === 'PROCESSING' || item.batch.status === 'PROCESSING') {
      return NextResponse.json(
        { success: false, error: 'Wait for processing to finish before changing manual edit status' },
        { status: 400 }
      );
    }

    if (action === 'ready_to_process') {
      await prisma.batchItem.update({
        where: { id: item.id },
        data: {
          status: 'READY_TO_PROCESS' as any,
          progress: 100,
          currentStep: null,
          errorMsg: null,
          completedAt: null,
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
      itemStatus: action === 'ready_to_process' ? 'READY_TO_PROCESS' : 'NEEDS_MANUAL_EDIT',
      batchStatus: batch.status,
    });

    return NextResponse.json({
      success: true,
      itemStatus: action === 'ready_to_process' ? 'READY_TO_PROCESS' : 'NEEDS_MANUAL_EDIT',
      batchStatus: batch.status,
      zipPath: item.zipPath,
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
