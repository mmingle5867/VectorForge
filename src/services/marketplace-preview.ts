/**
 * VectorForge - Marketplace Preview Image Generator
 * Composites the upscaled image with optional color tint, background, and watermark overlay.
 * Output: {basename}_preview.jpg
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface MarketplacePreviewOptions {
  /** Enable color tint overlay */
  enableColorTint: boolean;
  /** Hex color for tint (default #FFFFFF = no visible tint) */
  tintColor: string;
  /** Tint opacity 0-100 (percentage) */
  tintOpacity?: number;
  /** Watermark opacity 0-100 (percentage, default 80) */
  watermarkOpacity: number;
  /** Background image filename in base-assets folder */
  backgroundFilename: string;
  /** Watermark image filename in base-assets folder */
  watermarkFilename: string;
  /** Base assets directory path */
  baseAssetsPath: string;
}

export const DEFAULT_PREVIEW_OPTIONS: MarketplacePreviewOptions = {
  enableColorTint: false,
  tintColor: '#FFFFFF',
  tintOpacity: 20,
  watermarkOpacity: 80,
  backgroundFilename: 'preview-background.jpg',
  watermarkFilename: 'watermark.png',
  baseAssetsPath: './base-assets',
};

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generate a marketplace preview composite image.
 *
 * Pipeline:
 * 1. Start with the upscaled (or original) image
 * 2. Optionally apply color tint
 * 3. Composite onto background image
 * 4. Overlay watermark with configurable opacity
 * 5. Save as {baseName}_preview.jpg
 */
export async function generateMarketplacePreview(
  inputImagePath: string,
  outputDir: string,
  baseName: string,
  options: Partial<MarketplacePreviewOptions> = {}
): Promise<{ path: string; size: number } | null> {
  const opts = { ...DEFAULT_PREVIEW_OPTIONS, ...options };
  const outputFilename = `${baseName}_preview.jpg`;
  const outputPath = path.join(outputDir, outputFilename);

  try {
    logger.info(`MarketplacePreview: Generating preview for ${baseName}`, {
      enableColorTint: opts.enableColorTint,
      tintColor: opts.tintColor,
      watermarkOpacity: opts.watermarkOpacity,
    });

    // Read the source image
    const sourceImage = sharp(inputImagePath);
    const sourceMetadata = await sourceImage.metadata();
    const sourceWidth = sourceMetadata.width || 1000;
    const sourceHeight = sourceMetadata.height || 1000;

    // Step 1: Apply color tint if enabled
    let processedImage: sharp.Sharp;
    if (opts.enableColorTint && opts.tintColor !== '#FFFFFF') {
      const tintOpacity = Math.round(((opts.tintOpacity ?? 20) / 100) * 255);
      const tintHex = opts.tintColor.replace('#', '');
      const r = parseInt(tintHex.substring(0, 2), 16);
      const g = parseInt(tintHex.substring(2, 4), 16);
      const b = parseInt(tintHex.substring(4, 6), 16);

      // Create a tint overlay
      const tintOverlay = Buffer.from(
        `<svg width="${sourceWidth}" height="${sourceHeight}">
          <rect width="100%" height="100%" fill="rgba(${r},${g},${b},${tintOpacity / 255})"/>
        </svg>`
      );

      processedImage = sharp(await sourceImage.toBuffer()).composite([
        { input: tintOverlay, blend: 'over' },
      ]);
    } else {
      processedImage = sharp(await sourceImage.toBuffer());
    }

    // Get the processed image buffer
    let compositeBuffer = await processedImage.png().toBuffer();

    // Step 2: Composite onto background (if background exists)
    const backgroundPath = path.join(opts.baseAssetsPath, opts.backgroundFilename);
    let hasBackground = false;
    try {
      await fs.access(backgroundPath);
      hasBackground = true;
    } catch {
      logger.warn(`MarketplacePreview: Background not found at ${backgroundPath}, skipping`);
    }

    if (hasBackground) {
      const background = sharp(backgroundPath);
      const bgMetadata = await background.metadata();
      const bgWidth = bgMetadata.width || 1200;
      const bgHeight = bgMetadata.height || 1200;

      // Resize source image to fit within background (with padding)
      const maxWidth = Math.round(bgWidth * 0.8);
      const maxHeight = Math.round(bgHeight * 0.8);

      const resizedSource = await sharp(compositeBuffer)
        .resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

      const resizedMeta = await sharp(resizedSource).metadata();
      const rw = resizedMeta.width || maxWidth;
      const rh = resizedMeta.height || maxHeight;

      // Center the image on the background
      const left = Math.round((bgWidth - rw) / 2);
      const top = Math.round((bgHeight - rh) / 2);

      compositeBuffer = await background
        .composite([
          {
            input: resizedSource,
            left,
            top,
            blend: 'over',
          },
        ])
        .png()
        .toBuffer();
    }

    // Step 3: Overlay watermark (if watermark exists)
    const watermarkPath = path.join(opts.baseAssetsPath, opts.watermarkFilename);
    let hasWatermark = false;
    try {
      await fs.access(watermarkPath);
      hasWatermark = true;
    } catch {
      logger.warn(`MarketplacePreview: Watermark not found at ${watermarkPath}, skipping`);
    }

    if (hasWatermark) {
      const currentMeta = await sharp(compositeBuffer).metadata();
      const cw = currentMeta.width || 1200;
      const ch = currentMeta.height || 1200;

      // Read watermark and resize to fit
      const watermarkBuffer = await sharp(watermarkPath)
        .resize(Math.round(cw * 0.4), Math.round(ch * 0.4), {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

      // Apply opacity to watermark
      const opacity = opts.watermarkOpacity / 100;
      const watermarkWithOpacity = await sharp(watermarkBuffer)
        .ensureAlpha(opacity)
        .png()
        .toBuffer();

      const wmMeta = await sharp(watermarkWithOpacity).metadata();
      const wmW = wmMeta.width || 100;
      const wmH = wmMeta.height || 100;

      // Position watermark in center
      const wmLeft = Math.round((cw - wmW) / 2);
      const wmTop = Math.round((ch - wmH) / 2);

      compositeBuffer = await sharp(compositeBuffer)
        .composite([
          {
            input: watermarkWithOpacity,
            left: wmLeft,
            top: wmTop,
            blend: 'over',
          },
        ])
        .png()
        .toBuffer();
    }

    // Step 4: Save as JPEG
    await sharp(compositeBuffer)
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    const stats = await fs.stat(outputPath);

    logger.info(`MarketplacePreview: Preview generated successfully`, {
      outputPath,
      size: stats.size,
      hasBackground,
      hasWatermark,
    });

    return {
      path: outputPath,
      size: stats.size,
    };
  } catch (error) {
    logger.error(`MarketplacePreview: Failed to generate preview for ${baseName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default { generateMarketplacePreview };