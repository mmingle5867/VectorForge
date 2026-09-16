import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { renameArtwork } from '@/services/artwork-rename';
import { logger } from '@/lib/logger';
import { getManagedArtworkDirectory } from '@/lib/artwork-storage-paths';
import { deleteArtwork } from '@/services/artwork-delete';
import { deleteDirectArtwork, renameDirectArtwork } from '@/services/direct-artwork-actions';

function launchFolder(folderPath: string) {
  const command = process.platform === 'win32'
    ? 'explorer.exe'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const child = spawn(command, [folderPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

async function findOwnedItem(userId: string, itemId: string) {
  return prisma.batchItem.findFirst({
    where: { id: itemId, batch: { userId } },
    include: {
      assets: { select: { role: true, filePath: true } },
      batch: { select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, completedAt: true } },
    },
  });
}

async function findOwnedArtwork(userId: string, artworkId: string) {
  return prisma.artwork.findFirst({
    where: { id: artworkId, userId, batchItems: { none: {} } },
    include: {
      assets: { where: { role: { in: ['source-file', 'original-file'] } }, select: { role: true, filePath: true } },
      item: { select: { itemId: true } },
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { itemId } = await params;
    const item = await findOwnedItem(user.id, itemId);
    const artwork = item ? null : await findOwnedArtwork(user.id, itemId);
    const workingPath = item?.uploadPath ?? artwork?.assets.find((asset) => asset.role === 'source-file')?.filePath;
    if (!workingPath) return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    const managedDirectory = getManagedArtworkDirectory(workingPath);
    if (!managedDirectory) {
      return NextResponse.json({ success: false, error: 'Legacy artwork has no managed manifest yet' }, { status: 404 });
    }
    const manifestPath = path.join(
      managedDirectory,
      'vectorforge',
      'manifest',
      'manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    return NextResponse.json({
      success: true,
      manifest,
      manifestPath,
      originalPath: item?.assets.find((asset) => asset.role === 'original-file')?.filePath
        ?? artwork?.assets.find((asset) => asset.role === 'original-file')?.filePath ?? null,
      history: item ? {
        batchId: item.batch.id,
        batchName: item.batch.name,
        batchStatus: item.batch.status,
        batchCreatedAt: item.batch.createdAt,
        batchUpdatedAt: item.batch.updatedAt,
        batchCompletedAt: item.batch.completedAt,
        itemStatus: item.status,
        currentStep: item.currentStep,
        progress: item.progress,
        error: item.errorMsg,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      } : { artworkId: artwork?.artworkNumber, itemId: artwork?.item?.itemId ?? null, status: 'READY', createdAt: artwork?.createdAt, updatedAt: artwork?.updatedAt },
    });
  } catch (error) {
    logger.error('Dashboard file action failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Manifest unavailable' },
      { status: 404 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { itemId } = await params;
    const body = await req.json();
    const artwork = await findOwnedArtwork(user.id, itemId);
    if (artwork && body.action === 'rename') {
      const result = await renameDirectArtwork({ userId: user.id, artworkId: artwork.id, newBaseName: typeof body.baseName === 'string' ? body.baseName : '' });
      return NextResponse.json({ success: true, result });
    }
    if (artwork && (body.action === 'delete' || body.action === 'delete-artwork')) {
      const result = await deleteDirectArtwork({ userId: user.id, artworkId: artwork.id });
      return NextResponse.json({ success: true, result });
    }
    if (artwork && body.action === 'open-folder') {
      const workingPath = artwork.assets.find((asset) => asset.role === 'source-file')?.filePath;
      const managedDirectory = workingPath ? getManagedArtworkDirectory(workingPath) : null;
      if (!managedDirectory) return NextResponse.json({ success: false, error: 'Artwork has no managed directory' }, { status: 404 });
      launchFolder(path.dirname(workingPath));
      return NextResponse.json({ success: true });
    }
    if (artwork) {
      return NextResponse.json({ success: false, error: 'This artwork-first action will be added in the direct artwork actions slice' }, { status: 400 });
    }
    if (body.action === 'rename') {
      const result = await renameArtwork({
        userId: user.id,
        batchItemId: itemId,
        newBaseName: typeof body.baseName === 'string' ? body.baseName : '',
      });
      return NextResponse.json({ success: true, result });
    }
    if (body.action === 'delete' || body.action === 'delete-artwork') {
      const result = await deleteArtwork({ userId: user.id, batchItemId: itemId });
      return NextResponse.json({ success: true, result });
    }
    if (body.action !== 'open-folder') {
      return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 });
    }
    const item = await findOwnedItem(user.id, itemId);
    if (!item?.uploadPath) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }
    const managedDirectory = getManagedArtworkDirectory(item.uploadPath);
    if (!managedDirectory) {
      return NextResponse.json(
        { success: false, error: 'Move this older artwork into a managed Storage Location before opening its artwork folder' },
        { status: 400 }
      );
    }
    launchFolder(path.dirname(item.uploadPath));
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Dashboard file mutation failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to update artwork' },
      { status: 500 }
    );
  }
}
