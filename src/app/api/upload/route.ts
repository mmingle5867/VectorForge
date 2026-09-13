import { NextRequest, NextResponse } from 'next/server';

import config from '@/lib/config';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { ingestUploadedFiles } from '@/services/artwork-ingest';

function isSupportedUpload(file: File) {
  const supportedFormats = config.processing.supportedFormats as readonly string[];
  return supportedFormats.includes(file.type) || file.name.toLowerCase().endsWith('.svg');
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const formData = await req.formData();
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ success: false, error: 'No files provided' }, { status: 400 });
    }
    if (files.length > config.processing.maxBatchSize) {
      return NextResponse.json(
        { success: false, error: `Maximum ${config.processing.maxBatchSize} files per batch` },
        { status: 400 }
      );
    }
    const invalidFiles = files.filter(
      (file) => !isSupportedUpload(file) || file.size > config.processing.maxFileSize
    );
    if (invalidFiles.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported or oversized files: ${invalidFiles.map((file) => file.name).join(', ')}`,
        },
        { status: 400 }
      );
    }

    const result = await ingestUploadedFiles({ userId: user.id, files });
    if (!result.batchId) {
      return NextResponse.json(
        { success: false, error: 'No files were ingested', errors: result.errors },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      batchId: result.batchId,
      files: result.files.map((file) => ({
        id: file.id,
        originalFilename: file.originalFilename,
        baseName: file.baseName,
        mimeType: files.find((input) => input.name === file.originalFilename)?.type || '',
        size: files.find((input) => input.name === file.originalFilename)?.size || 0,
        width: null,
        height: null,
        uploadPath: file.workingPath,
        previewUrl: file.previewUrl,
      })),
      errors: result.errors,
      storage: result.storage,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Upload ingest failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
