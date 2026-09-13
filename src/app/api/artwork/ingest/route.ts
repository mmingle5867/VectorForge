import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import config from '@/lib/config';
import { requireAuth } from '@/lib/auth';
import { semaLocalToken } from '@/lib/sema-id';
import { logger } from '@/lib/logger';
import { ingestArtworkDirect } from '@/services/artwork-direct-ingest';
import { configureDefaultImportStorageForUser, getVectorForgeStoragePaths } from '@/services/profile-storage';
import { createCoreCommand } from '@/services/sema-core';

export const runtime = 'nodejs';

function isSupportedUpload(file: File) {
  const supportedFormats = config.processing.supportedFormats as readonly string[];
  return supportedFormats.includes(file.type) || file.name.toLowerCase().endsWith('.svg');
}

function safeFilename(value: string) {
  const leaf = path.basename(value).trim();
  return leaf.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 220) || 'artwork';
}

/**
 * Artwork-first intake. It intentionally exists beside `/api/upload` while the
 * legacy Batch review screen is replaced. This endpoint creates no Batch,
 * BatchItem, AssetProfile, SKU, or package record.
 */
export async function POST(req: NextRequest) {
  const stagedPaths: string[] = [];
  try {
    const user = await requireAuth();
    const formData = await req.formData();
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);
    if (!files.length) return NextResponse.json({ success: false, error: 'No files provided' }, { status: 400 });
    if (files.length > config.processing.maxBatchSize) {
      return NextResponse.json({ success: false, error: `Maximum ${config.processing.maxBatchSize} files per request` }, { status: 400 });
    }
    const invalid = files.filter((file) => !isSupportedUpload(file) || file.size > config.processing.maxFileSize);
    if (invalid.length) {
      return NextResponse.json({ success: false, error: `Unsupported or oversized files: ${invalid.map((file) => file.name).join(', ')}` }, { status: 400 });
    }

    const storage = await configureDefaultImportStorageForUser({ userId: user.id });
    const storagePaths = getVectorForgeStoragePaths(storage.location.basePath);
    await mkdir(storagePaths.processing, { recursive: true });
    const staged = [] as Array<{ stagedPath: string; originalFilename: string; mimeType: string }>;
    for (const file of files) {
      const stageCommand = await createCoreCommand({
        commandType: 'vectorforge.artwork.stage-upload', actorId: user.id, workspaceId: storage.workspace.id,
        payload: { filename: file.name, byteLength: file.size },
      });
      const stagedPath = path.join(storagePaths.processing, `.intake-${semaLocalToken(stageCommand.id)}-${safeFilename(file.name)}`);
      await writeFile(stagedPath, Buffer.from(await file.arrayBuffer()), { flag: 'wx' });
      stagedPaths.push(stagedPath);
      await (await import('@/lib/prisma')).default.semaCoreCommand.update({ where: { id: stageCommand.id }, data: { status: 'SUCCESS' } });
      staged.push({ stagedPath, originalFilename: file.name, mimeType: file.type });
    }
    const result = await ingestArtworkDirect({ userId: user.id, files: staged });
    return NextResponse.json({ success: result.files.length > 0, ...result });
  } catch (error) {
    await Promise.all(stagedPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    logger.error('Artwork-first ingest failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}
