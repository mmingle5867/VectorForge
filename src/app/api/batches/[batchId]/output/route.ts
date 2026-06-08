/**
 * VectorForge - Batch Output API Route
 * Returns the output details for a completed batch including file listings and download links.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { formatBytes } from '@/lib/utils';

interface OutputItem {
  id: string;
  baseName: string;
  sku: string | null;
  status: string;
  outputFolderPath: string | null;
  zipPath: string | null;
  files: FileInfo[];
  folderSize: number;
  zipSize: number;
}

interface FileInfo {
  name: string;
  size: number;
  sizeFormatted: string;
  type: string;
}

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

    const outputItems: OutputItem[] = [];

    for (const item of batch.items) {
      const files: FileInfo[] = [];
      let folderSize = 0;
      let zipSize = 0;

      // List files in output folder
      if (item.outputFolderPath) {
        try {
          const entries = await readdir(item.outputFolderPath);
          for (const entry of entries) {
            const filePath = path.join(item.outputFolderPath, entry);
            const fileStat = await stat(filePath);
            if (fileStat.isFile()) {
              const ext = path.extname(entry).toLowerCase();
              files.push({
                name: entry,
                size: fileStat.size,
                sizeFormatted: formatBytes(fileStat.size),
                type: getFileType(ext),
              });
              folderSize += fileStat.size;
            }
          }
        } catch {
          // Folder may not exist
        }
      }

      // Get ZIP size
      if (item.zipPath) {
        try {
          const zipStat = await stat(item.zipPath);
          zipSize = zipStat.size;
        } catch {
          // ZIP may not exist
        }
      }

      outputItems.push({
        id: item.id,
        baseName: item.baseName,
        sku: item.sku,
        status: item.status,
        outputFolderPath: item.outputFolderPath,
        zipPath: item.zipPath,
        files,
        folderSize,
        zipSize,
      });
    }

    // Calculate totals
    const totalFolderSize = outputItems.reduce((sum, item) => sum + item.folderSize, 0);
    const totalZipSize = outputItems.reduce((sum, item) => sum + item.zipSize, 0);

    return NextResponse.json({
      success: true,
      batch: {
        id: batch.id,
        name: batch.name,
        status: batch.status,
        totalItems: batch.totalItems,
        completedItems: batch.completedItems,
        failedItems: batch.failedItems,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt,
      },
      items: outputItems,
      totals: {
        folderSize: totalFolderSize,
        folderSizeFormatted: formatBytes(totalFolderSize),
        zipSize: totalZipSize,
        zipSizeFormatted: formatBytes(totalZipSize),
        fileCount: outputItems.reduce((sum, item) => sum + item.files.length, 0),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Failed to fetch output' },
      { status: 500 }
    );
  }
}

function getFileType(ext: string): string {
  const types: Record<string, string> = {
    '.svg': 'vector',
    '.ai': 'vector',
    '.eps': 'vector',
    '.dxf': 'cad',
    '.png': 'image',
    '.jpg': 'image',
    '.jpeg': 'image',
    '.txt': 'text',
    '.zip': 'archive',
    '.mp4': 'video',
  };
  return types[ext] || 'other';
}