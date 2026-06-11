/**
 * VectorForge - Batches API Route
 * List all batches for the current user.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const user = await requireAuth();

    const batches = await prisma.batch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        totalItems: true,
        completedItems: true,
        failedItems: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        items: {
          orderBy: { sequenceNumber: 'asc' },
          take: 3,
          select: {
            originalFilename: true,
            baseName: true,
            status: true,
            outputFolderPath: true,
          },
        },
      },
    });

    const batchIds = batches.map((batch) => batch.id);
    const outputItems = await prisma.batchItem.findMany({
      where: {
        batchId: { in: batchIds },
        outputFolderPath: { not: null },
      },
      orderBy: { sequenceNumber: 'asc' },
      select: {
        batchId: true,
        outputFolderPath: true,
      },
    });
    const firstOutputFolderByBatch = new Map<string, string>();

    for (const item of outputItems) {
      if (item.outputFolderPath && !firstOutputFolderByBatch.has(item.batchId)) {
        firstOutputFolderByBatch.set(item.batchId, item.outputFolderPath);
      }
    }

    return NextResponse.json({
      success: true,
      batches: batches.map((batch) => ({
        ...batch,
        itemCount: batch.totalItems,
        firstOutputFolderPath: firstOutputFolderByBatch.get(batch.id) || null,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
