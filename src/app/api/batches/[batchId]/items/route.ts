/**
 * VectorForge - Batch Items API Route
 * Update batch items (base name, upscale factor) during pre-conversion review.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { updateBatchItemSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';

// GET - List all items in a batch
export async function GET(
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
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      batch: {
        id: batch.id,
        status: batch.status,
        totalItems: batch.totalItems,
        upscaleFactor: batch.upscaleFactor,
        smartUpscaleThreshold: batch.smartUpscaleThreshold,
      },
      items: batch.items.map((item) => ({
        id: item.id,
        originalFilename: item.originalFilename,
        baseName: item.baseName,
        sequenceNumber: item.sequenceNumber,
        mimeType: item.mimeType,
        originalWidth: item.originalWidth,
        originalHeight: item.originalHeight,
        originalSize: item.originalSize,
        upscaleFactor: item.upscaleFactor,
        status: item.status,
        previewUrl: `/api/preview/${item.id}`,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update individual batch items
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId } = await params;
    const body = await req.json();

    // Verify batch ownership
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (batch.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Cannot modify items after processing has started' },
        { status: 400 }
      );
    }

    // Expect body: { items: [{ id, baseName, upscaleFactor }] }
    const { items } = body;

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const updatedItems = [];

    for (const itemUpdate of items) {
      const { id, baseName, upscaleFactor } = itemUpdate;

      // Validate
      const validation = updateBatchItemSchema.safeParse({ baseName, upscaleFactor });
      if (!validation.success) {
        return NextResponse.json(
          { error: `Invalid data for item ${id}: ${validation.error.message}` },
          { status: 400 }
        );
      }

      const updated = await prisma.batchItem.update({
        where: { id, batchId },
        data: {
          baseName: validation.data.baseName,
          upscaleFactor: validation.data.upscaleFactor || batch.upscaleFactor,
        },
      });

      updatedItems.push(updated);
    }

    logger.info(`Batch items updated`, { batchId, count: updatedItems.length });

    return NextResponse.json({ success: true, items: updatedItems });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Batch items update error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}