import { NextRequest, NextResponse } from 'next/server';
import { access, readFile } from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { findExistingNamedFilePath, getPackageBaseName } from '@/lib/output-naming';

function mimeTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function pathExists(filePath: string | null | undefined) {
  if (!filePath) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findThumbnailPath(outputFolderPath: string, baseNames: string[]) {
  const preferredExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];

  for (const extension of preferredExtensions) {
    const match = await findExistingNamedFilePath(outputFolderPath, baseNames, extension);
    if (match) {
      return match;
    }
  }

  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { itemId } = await params;

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item || item.batch.userId !== user.id) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (!item.outputFolderPath) {
      return NextResponse.json({ success: false, error: 'No output folder available' }, { status: 404 });
    }

    const packageBaseName = getPackageBaseName(item.outputFolderPath);
    const thumbnailPath = await findThumbnailPath(item.outputFolderPath, [packageBaseName, item.baseName]);
    if (!thumbnailPath || !(await pathExists(thumbnailPath))) {
      return NextResponse.json({ success: false, error: 'Thumbnail not found' }, { status: 404 });
    }

    const imageBuffer = await readFile(thumbnailPath);
    return new Response(imageBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': mimeTypeFor(thumbnailPath),
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load package thumbnail' },
      { status: 500 }
    );
  }
}
