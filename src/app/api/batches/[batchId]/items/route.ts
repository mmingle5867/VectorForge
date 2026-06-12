/**
 * VectorForge - Batch Items API Route
 * Update batch items (base name, upscale factor) during pre-conversion review.
 */

import { NextRequest, NextResponse } from 'next/server';
import { access } from 'fs/promises';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { updateBatchItemSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';
import {
  findExistingFilePath,
  findExistingNamedFilePath,
  getPackageBaseName,
} from '@/lib/output-naming';
import { getBatchSummaryStatus } from '@/services/batch-status';

async function fileExists(filePath: string | null | undefined) {
  if (!filePath) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
    const summary = getBatchSummaryStatus(batch.items);

    return NextResponse.json({
      success: true,
      batch: {
        id: batch.id,
        status: summary.status,
        statusLabel: summary.label,
        statusCounts: summary.counts,
        totalItems: batch.totalItems,
        upscaleFactor: batch.upscaleFactor,
        smartUpscaleThreshold: batch.smartUpscaleThreshold,
      },
      items: await Promise.all(
        batch.items.map(async (item) => {
          const packageBaseName = item.outputFolderPath
            ? getPackageBaseName(item.outputFolderPath)
            : item.baseName;
          const candidateBaseNames = [packageBaseName, item.baseName];
          const svgPath = await findExistingFilePath([
            item.svgPath,
            await findExistingNamedFilePath(item.outputFolderPath, candidateBaseNames, '.svg'),
          ]);
          const pngPath = await findExistingNamedFilePath(item.outputFolderPath, candidateBaseNames, '.png');
          const jpgPath = await findExistingNamedFilePath(item.outputFolderPath, candidateBaseNames, '.jpg');

          return {
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
            outputFolderPath: item.outputFolderPath,
            zipPath: item.zipPath,
            files: {
              svg: { exists: await fileExists(svgPath), path: svgPath },
              png: { exists: await fileExists(pngPath), path: pngPath },
              jpg: { exists: await fileExists(jpgPath), path: jpgPath },
            },
            previewUrl: `/api/preview/${item.id}`,
          };
        })
      ),
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
