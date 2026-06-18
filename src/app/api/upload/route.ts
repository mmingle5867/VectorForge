/**
 * VectorForge - File Upload API Route
 * Handles bulk file uploads (max 50 files per batch).
 * Saves files to the configured upload directory and creates batch/item records.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import config from '@/lib/config';
import { logger } from '@/lib/logger';
import { extractBaseName } from '@/lib/utils';
import { resolveManagedPath } from '@/lib/path-management';

function isSupportedUpload(file: File) {
  const supportedFormats = config.processing.supportedFormats as readonly string[];
  return supportedFormats.includes(file.type) || file.name.toLowerCase().endsWith('.svg');
}

function getExtendedPath(settingsJson: unknown, key: string, fallback: string) {
  if (settingsJson && typeof settingsJson === 'object' && !Array.isArray(settingsJson)) {
    const value = (settingsJson as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();

    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No files provided' },
        { status: 400 }
      );
    }

    if (files.length > config.processing.maxBatchSize) {
      return NextResponse.json(
        { success: false, error: `Maximum ${config.processing.maxBatchSize} files per batch` },
        { status: 400 }
      );
    }

    // Validate file types
    const invalidFiles = files.filter((f) => !isSupportedUpload(f));
    if (invalidFiles.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file types: ${invalidFiles.map((f) => f.name).join(', ')}. Use JPG, PNG, WebP, TIFF, or SVG.`,
        },
        { status: 400 }
      );
    }

    // Get user settings for defaults
    const settings = user.settings;
    const upscaleFactor = settings?.defaultUpscaleFactor || config.processing.defaultUpscaleFactor;
    const threshold = settings?.smartUpscaleThreshold || config.processing.smartUpscaleThreshold;
    const uploadRoot = resolveManagedPath(
      getExtendedPath(settings?.defaultSubstitutions, 'uploadPath', config.paths.uploads)
    );

    // Create batch record
    const batch = await prisma.batch.create({
      data: {
        userId: user.id,
        totalItems: files.length,
        upscaleFactor,
        smartUpscaleThreshold: threshold,
        useBaseAssets: false,
        substitutionData: settings?.defaultSubstitutions || {},
      },
    });

    // Create upload directory for this batch
    const batchUploadDir = path.join(uploadRoot, batch.id);
    await mkdir(batchUploadDir, { recursive: true });

    // Process each file
    const uploadedItems = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        // Validate file size
        if (file.size > config.processing.maxFileSize) {
          errors.push({ filename: file.name, error: 'File too large (max 50MB)' });
          continue;
        }

        // Generate unique filename
        const ext = path.extname(file.name);
        const fileId = uuidv4();
        const savedFilename = `${fileId}${ext}`;
        const filePath = path.join(batchUploadDir, savedFilename);

        // Save file to disk
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(filePath, buffer);

        // Get image metadata using Sharp
        let metadata;
        try {
          metadata = await sharp(buffer).metadata();
        } catch {
          metadata = { width: null, height: null };
        }

        // Extract base name from original filename
        const baseName = extractBaseName(file.name);

        // Create batch item record
        const item = await prisma.batchItem.create({
          data: {
            batchId: batch.id,
            originalFilename: file.name,
            baseName,
            sequenceNumber: i + 1,
            mimeType: file.type,
            originalWidth: metadata.width || null,
            originalHeight: metadata.height || null,
            originalSize: file.size,
            uploadPath: filePath,
            upscaleFactor,
          },
        });

        uploadedItems.push({
          id: item.id,
          originalFilename: file.name,
          baseName: item.baseName,
          mimeType: file.type,
          size: file.size,
          width: metadata.width || null,
          height: metadata.height || null,
          uploadPath: filePath,
          previewUrl: `/api/preview/${item.id}`,
        });
      } catch (error) {
        logger.error(`Upload: Failed to process file ${file.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        errors.push({ filename: file.name, error: 'Failed to process file' });
      }
    }

    logger.info(`Upload: Batch ${batch.id} created with ${uploadedItems.length} items`, {
      batchId: batch.id,
      userId: user.id,
      totalFiles: files.length,
      successful: uploadedItems.length,
      failed: errors.length,
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      files: uploadedItems,
      errors,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Upload: Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
