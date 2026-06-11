/**
 * VectorForge - Image Preview API Route
 * Serves uploaded image previews for the review screen.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import sharp from 'sharp';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { isSvgMimeOrPath, normalizeImportedSvg } from '@/lib/svg-normalize';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { itemId } = await params;

    // Find the batch item
    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item || item.batch.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!item.uploadPath) {
      return NextResponse.json({ error: 'No file available' }, { status: 404 });
    }

    // Read and resize for preview (max 800px)
    const fileBuffer = await readFile(item.uploadPath);
    if (isSvgMimeOrPath(item.mimeType, item.uploadPath)) {
      const normalized = normalizeImportedSvg(fileBuffer.toString('utf-8'));

      return new Response(normalized.svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }

    const previewBuffer = await sharp(fileBuffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    return new Response(previewBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
