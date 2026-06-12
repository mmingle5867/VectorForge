/**
 * VectorForge - Batches API Route
 * List all batches for the current user.
 */

import { NextResponse } from 'next/server';
import { access } from 'fs/promises';
import { requireAuth } from '@/lib/auth';
import {
  findExistingFilePath,
  findExistingNamedFilePath,
  getPackageBaseName,
} from '@/lib/output-naming';
import prisma from '@/lib/prisma';
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
          select: {
            id: true,
            originalFilename: true,
            baseName: true,
            status: true,
            errorMsg: true,
            svgPath: true,
            outputFolderPath: true,
            createdAt: true,
            updatedAt: true,
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
      batches: await Promise.all(
        batches.map(async (batch) => {
          const summary = getBatchSummaryStatus(batch.items);

          return {
            ...batch,
            status: summary.status,
            statusLabel: summary.label,
            statusCounts: summary.counts,
            itemCount: batch.totalItems,
            firstOutputFolderPath: firstOutputFolderByBatch.get(batch.id) || null,
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
                status: item.status,
                errorMsg: item.errorMsg,
                outputFolderPath: item.outputFolderPath,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                files: {
                  svg: { exists: await fileExists(svgPath), path: svgPath },
                  png: { exists: await fileExists(pngPath), path: pngPath },
                  jpg: { exists: await fileExists(jpgPath), path: jpgPath },
                },
              };
              })
            ),
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
