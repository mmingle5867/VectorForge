import { NextRequest, NextResponse } from 'next/server';
import { rm } from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';

function resolveConfiguredPath(configuredPath: string) {
  return path.resolve(process.cwd(), configuredPath);
}

function isInsideDirectory(targetPath: string, directoryPath: string) {
  const relative = path.relative(directoryPath, targetPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function removeIfSafe(targetPath: string, rootPath: string) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);

  if (!isInsideDirectory(resolvedTarget, resolvedRoot)) {
    return { path: targetPath, deleted: false, reason: 'outside allowed directory' };
  }

  await rm(resolvedTarget, { recursive: true, force: true });
  return { path: targetPath, deleted: true };
}

async function recalculateBatchCounts(batchId: string) {
  const items = await prisma.batchItem.findMany({
    where: { batchId },
    select: { status: true },
  });
  const completedItems = items.filter((item) => item.status === 'COMPLETED').length;
  const failedItems = items.filter((item) => item.status === 'FAILED').length;

  await prisma.batch.update({
    where: { id: batchId },
    data: {
      totalItems: items.length,
      completedItems,
      failedItems,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;
    const body = await req.json().catch(() => ({}));
    const deleteFiles = Boolean(body.deleteFiles);

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item || item.batchId !== batchId || item.batch.userId !== user.id) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (item.batch.status === 'PROCESSING') {
      return NextResponse.json(
        { success: false, error: 'Cancel or wait for processing to finish before deleting this item' },
        { status: 400 }
      );
    }

    const deletedPaths: string[] = [];
    const skippedPaths: { path: string; reason: string }[] = [];

    if (deleteFiles) {
      const uploadRoot = resolveConfiguredPath(config.paths.uploads);
      const outputRoot = resolveConfiguredPath(user.settings?.outputPath || config.paths.output);
      const targets = [
        item.uploadPath ? { path: item.uploadPath, root: uploadRoot } : null,
        item.outputFolderPath ? { path: item.outputFolderPath, root: outputRoot } : null,
        item.zipPath ? { path: item.zipPath, root: outputRoot } : null,
      ].filter((target): target is { path: string; root: string } => !!target);

      for (const target of targets) {
        const result = await removeIfSafe(target.path, target.root);
        if (result.deleted) {
          deletedPaths.push(result.path);
        } else {
          skippedPaths.push({ path: result.path, reason: result.reason || 'not deleted' });
        }
      }
    }

    await prisma.batchItem.delete({
      where: { id: itemId },
    });
    await recalculateBatchCounts(batchId);

    logger.info(`Batch item ${itemId} deleted by user ${user.id}`, {
      batchId,
      itemId,
      userId: user.id,
      deleteFiles,
      deletedPathCount: deletedPaths.length,
      skippedPathCount: skippedPaths.length,
    });

    return NextResponse.json({
      success: true,
      message: deleteFiles ? 'Item and files deleted' : 'Item deleted',
      deletedPaths,
      skippedPaths,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Delete item error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete item' },
      { status: 500 }
    );
  }
}
