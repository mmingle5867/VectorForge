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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId } = await params;
    const body = await req.json().catch(() => ({}));
    const deleteFiles = Boolean(body.deleteFiles);

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });

    if (!batch || batch.userId !== user.id) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (batch.status === 'PROCESSING') {
      return NextResponse.json(
        { success: false, error: 'Cancel or wait for processing to finish before deleting this batch' },
        { status: 400 }
      );
    }

    const deletedPaths: string[] = [];
    const skippedPaths: { path: string; reason: string }[] = [];

    if (deleteFiles) {
      const uploadRoot = resolveConfiguredPath(config.paths.uploads);
      const outputRoot = resolveConfiguredPath(user.settings?.outputPath || config.paths.output);
      const uploadFolder = path.join(uploadRoot, batch.id);
      const fileTargets = new Set<string>([uploadFolder]);

      for (const item of batch.items) {
        if (item.outputFolderPath) {
          fileTargets.add(item.outputFolderPath);
        }
        if (item.zipPath) {
          fileTargets.add(item.zipPath);
        }
      }

      for (const target of fileTargets) {
        const root = path.resolve(target) === path.resolve(uploadFolder) ? uploadRoot : outputRoot;
        const result = await removeIfSafe(target, root);
        if (result.deleted) {
          deletedPaths.push(result.path);
        } else {
          skippedPaths.push({ path: result.path, reason: result.reason || 'not deleted' });
        }
      }
    }

    await prisma.batch.delete({
      where: { id: batchId },
    });

    logger.info(`Batch ${batchId} deleted by user ${user.id}`, {
      batchId,
      userId: user.id,
      deleteFiles,
    });

    return NextResponse.json({
      success: true,
      message: deleteFiles ? 'Batch and files deleted' : 'Batch deleted',
      deletedPaths,
      skippedPaths,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Delete batch error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete batch' },
      { status: 500 }
    );
  }
}
