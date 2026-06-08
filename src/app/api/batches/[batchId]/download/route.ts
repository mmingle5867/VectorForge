/**
 * VectorForge - Download ZIP API Route
 * Serves the ZIP file for a specific batch item.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId } = await params;
    const { searchParams } = new URL(req.url);
    const itemId = searchParams.get('itemId');

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });

    if (!batch || batch.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // If itemId specified, download that specific item's ZIP
    if (itemId) {
      const item = batch.items.find((i) => i.id === itemId);
      if (!item || !item.zipPath) {
        return NextResponse.json({ error: 'ZIP not found' }, { status: 404 });
      }

      const zipBuffer = await readFile(item.zipPath);
      const filename = `${item.baseName}_bundle.zip`;

      return new Response(zipBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(zipBuffer.length),
        },
      });
    }

    // Download all items as one combined ZIP (batch-level download)
    // For now, return the first completed item's ZIP or error
    const completedItems = batch.items.filter(
      (i) => i.status === 'COMPLETED' && i.zipPath
    );

    if (completedItems.length === 0) {
      return NextResponse.json(
        { error: 'No completed items to download' },
        { status: 404 }
      );
    }

    // If only one item, serve it directly
    if (completedItems.length === 1) {
      const item = completedItems[0];
      const zipBuffer = await readFile(item.zipPath!);
      const filename = `${item.baseName}_bundle.zip`;

      return new Response(zipBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(zipBuffer.length),
        },
      });
    }

    // Multiple items — create a combined ZIP
    const JSZip = (await import('jszip')).default;
    const combinedZip = new JSZip();

    for (const item of completedItems) {
      if (item.zipPath) {
        try {
          const zipBuffer = await readFile(item.zipPath);
          combinedZip.file(`${item.baseName}_bundle.zip`, zipBuffer);
        } catch {
          // Skip items whose ZIP is missing
        }
      }
    }

    const combinedBuffer = await combinedZip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const batchName = batch.name || `batch_${batchId.slice(0, 8)}`;
    const filename = `${batchName}_all.zip`;

    return new Response(combinedBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(combinedBuffer.length),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Failed to download' },
      { status: 500 }
    );
  }
}