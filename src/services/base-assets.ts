/**
 * VectorForge - Base Assets Fallback Service
 * Manages the base asset directory system.
 * For each batch: checks for required files in the batch folder first,
 * then falls back to copying from the base-assets directory.
 */

import path from 'path';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';
import config from '@/lib/config';

// Standard base asset filenames to check for
const BASE_ASSET_FILES = [
  'video.mp4',
  'image1.jpg',
  'image1.png',
  'image2.jpg',
  'image2.png',
  'image3.jpg',
  'image3.png',
  'template.svg',
  'watermark.png',
  'logo.png',
];

/**
 * Check and copy base assets to the output folder.
 * For each expected base asset:
 * 1. Check if it exists in the batch-specific folder
 * 2. If missing, copy from the global base-assets directory
 */
export async function applyBaseAssets(
  outputDir: string,
  baseAssetsPath?: string
): Promise<string[]> {
  const assetsDir = baseAssetsPath || config.paths.baseAssets;
  const copiedFiles: string[] = [];

  logger.info(`Base Assets: Checking for fallback assets`, {
    outputDir,
    assetsDir,
  });

  // Check if base assets directory exists
  try {
    await fs.access(assetsDir);
  } catch {
    logger.info(`Base Assets: Directory not found, skipping`, { assetsDir });
    return copiedFiles;
  }

  // Get list of files in the base assets directory
  let baseAssetEntries: string[];
  try {
    baseAssetEntries = await fs.readdir(assetsDir);
  } catch {
    logger.warn(`Base Assets: Cannot read directory`, { assetsDir });
    return copiedFiles;
  }

  // For each base asset file, check if it exists in output, copy if not
  for (const filename of baseAssetEntries) {
    const outputFilePath = path.join(outputDir, filename);
    const baseAssetFilePath = path.join(assetsDir, filename);

    try {
      // Check if file already exists in output
      await fs.access(outputFilePath);
      // File exists, skip
      logger.debug(`Base Assets: ${filename} already exists in output, skipping`);
    } catch {
      // File doesn't exist in output, copy from base assets
      try {
        const stat = await fs.stat(baseAssetFilePath);
        if (stat.isFile()) {
          await fs.copyFile(baseAssetFilePath, outputFilePath);
          copiedFiles.push(filename);
          logger.info(`Base Assets: Copied fallback ${filename} to output`);
        }
      } catch (copyError) {
        logger.warn(`Base Assets: Failed to copy ${filename}`, {
          error: copyError instanceof Error ? copyError.message : String(copyError),
        });
      }
    }
  }

  return copiedFiles;
}

/**
 * Initialize the base assets directory if it doesn't exist.
 * Creates the directory with a README explaining its purpose.
 */
export async function initBaseAssetsDir(baseAssetsPath?: string): Promise<void> {
  const assetsDir = baseAssetsPath || config.paths.baseAssets;

  try {
    await fs.access(assetsDir);
  } catch {
    await fs.mkdir(assetsDir, { recursive: true });

    const readme = `# Base Assets Directory

Place fallback/template files here that should be included in every batch output.

## How it works:
- When processing a batch, VectorForge checks if these files exist in the item's output folder.
- If a file is missing from the output, it will be automatically copied from this directory.

## Common files to place here:
- video.mp4 - Product video template
- image1.jpg, image2.png - Additional product images
- template.svg - SVG template overlay
- watermark.png - Watermark image
- logo.png - Brand logo

## Notes:
- All paths are relative
- Files here serve as fallbacks only
- Batch-specific files always take priority
`;

    await fs.writeFile(path.join(assetsDir, 'README.md'), readme, 'utf-8');
    logger.info(`Base Assets: Initialized directory at ${assetsDir}`);
  }
}

export default { applyBaseAssets, initBaseAssetsDir };