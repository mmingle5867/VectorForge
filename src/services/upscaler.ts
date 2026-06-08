/**
 * VectorForge - Image Upscaling Service
 * Uses Sharp.js for high-quality image upscaling before vector conversion.
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';
import type { UpscaleOptions, UpscaleResult } from '@/lib/types';

/**
 * Upscale an image using Sharp.js with smart threshold logic.
 * Only upscales if the image dimensions are below the configured threshold.
 * Always keeps the original file alongside the upscaled version.
 */
export async function upscaleImage(
  inputPath: string,
  outputDir: string,
  options: UpscaleOptions
): Promise<UpscaleResult> {
  const { factor, threshold, keepOriginal } = options;

  // Read image metadata
  const metadata = await sharp(inputPath).metadata();
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;

  logger.info(`Upscaler: Processing ${path.basename(inputPath)}`, {
    originalWidth,
    originalHeight,
    factor,
    threshold,
  });

  // Copy original to output directory (always keep original)
  const originalFilename = path.basename(inputPath);
  const originalOutputPath = path.join(outputDir, `original_${originalFilename}`);
  await fs.copyFile(inputPath, originalOutputPath);

  // Smart upscaling: only upscale if below threshold
  const needsUpscale =
    factor > 1 && (originalWidth < threshold || originalHeight < threshold);

  if (!needsUpscale) {
    logger.info(`Upscaler: Skipping upscale (dimensions above threshold or factor=1)`, {
      originalWidth,
      originalHeight,
      threshold,
      factor,
    });

    return {
      applied: false,
      originalPath: originalOutputPath,
      upscaledPath: null,
      originalWidth,
      originalHeight,
      upscaledWidth: null,
      upscaledHeight: null,
      factor: 1,
    };
  }

  // Perform upscaling
  const upscaledWidth = originalWidth * factor;
  const upscaledHeight = originalHeight * factor;
  const ext = path.extname(originalFilename);
  const baseName = path.basename(originalFilename, ext);
  const upscaledFilename = `upscaled_${factor}x_${baseName}${ext}`;
  const upscaledPath = path.join(outputDir, upscaledFilename);

  await sharp(inputPath)
    .resize(upscaledWidth, upscaledHeight, {
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .toFile(upscaledPath);

  logger.info(`Upscaler: Successfully upscaled to ${upscaledWidth}x${upscaledHeight}`, {
    upscaledPath,
    factor,
  });

  return {
    applied: true,
    originalPath: originalOutputPath,
    upscaledPath,
    originalWidth,
    originalHeight,
    upscaledWidth,
    upscaledHeight,
    factor,
  };
}

/**
 * Generate a thumbnail preview image.
 */
export async function generatePreview(
  inputPath: string,
  outputDir: string,
  maxSize: number = 400
): Promise<string> {
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const previewFilename = `preview_${baseName}.jpg`;
  const previewPath = path.join(outputDir, previewFilename);

  await sharp(inputPath)
    .resize(maxSize, maxSize, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toFile(previewPath);

  return previewPath;
}

export default { upscaleImage, generatePreview };