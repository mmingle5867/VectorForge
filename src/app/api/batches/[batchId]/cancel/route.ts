/**
 * VectorForge - Cancel Batch API Route
 * Cancels an active batch and removes pending jobs from the queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId } = await params;

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (batch.status === 'COMPLETED' || batch.status === 'CANCELLED') {
      return NextResponse.json(
        { error: `Batch is already ${batch.status.toLowerCase()}` },
        { status: 400 }
      );
    }

    // Update batch status
    await prisma.batch.update({
      where: { id: batchId },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });

    // Mark all pending items as failed (no CANCELLED status for items)
    await prisma.batchItem.updateMany({
      where: {
        batchId,
        status: 'PENDING',
      },
      data: {
        status: 'FAILED',
        currentStep: null,
      },
    });

    logger.info(`Batch ${batchId} cancelled by user ${user.id}`);

    return NextResponse.json({ success: true, message: 'Batch cancelled' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Cancel batch error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to cancel batch' },
      { status: 500 }
    );
  }
}