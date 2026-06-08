/**
 * VectorForge - ZIP Generation Service
 * Creates ZIP bundles containing all generated files for a batch item.
 * The ZIP contains the exact same files as the unzipped output folder.
 */

import JSZip from 'jszip';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';
import type { GeneratedFile } from '@/lib/types';

/**
 * Create a ZIP file from an output folder.
 * The ZIP mirrors the exact contents of the unzipped folder.
 */
export async function createZipFromFolder(
  folderPath: string,
  zipOutputPath: string
): Promise<{ zipPath: string; size: number }> {
  const zip = new JSZip();
  const folderName = path.basename(folderPath);

  logger.info(`ZIP: Creating archive from folder`, { folderPath, zipOutputPath });

  // Recursively add all files from the folder
  await addFolderToZip(zip, folderPath, folderName);

  // Generate the ZIP buffer
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  // Write the ZIP file
  await fs.writeFile(zipOutputPath, zipBuffer);
  const stats = await fs.stat(zipOutputPath);

  logger.info(`ZIP: Archive created successfully`, {
    zipPath: zipOutputPath,
    size: stats.size,
  });

  return {
    zipPath: zipOutputPath,
    size: stats.size,
  };
}

/**
 * Recursively add a folder's contents to a JSZip instance.
 */
async function addFolderToZip(
  zip: JSZip,
  folderPath: string,
  zipFolderName: string
): Promise<void> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    const zipPath = `${zipFolderName}/${entry.name}`;

    if (entry.isDirectory()) {
      await addFolderToZip(zip, fullPath, zipPath);
    } else {
      const fileBuffer = await fs.readFile(fullPath);
      zip.file(zipPath, fileBuffer);
    }
  }
}

/**
 * Create a ZIP from a list of generated files.
 * Alternative approach when you have the file list directly.
 */
export async function createZipFromFiles(
  files: GeneratedFile[],
  folderName: string,
  zipOutputPath: string
): Promise<{ zipPath: string; size: number }> {
  const zip = new JSZip();

  logger.info(`ZIP: Creating archive from ${files.length} files`, {
    folderName,
    zipOutputPath,
  });

  for (const file of files) {
    try {
      const fileBuffer = await fs.readFile(file.path);
      zip.file(`${folderName}/${file.filename}`, fileBuffer);
    } catch (error) {
      logger.warn(`ZIP: Failed to add file ${file.filename}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  await fs.writeFile(zipOutputPath, zipBuffer);
  const stats = await fs.stat(zipOutputPath);

  return {
    zipPath: zipOutputPath,
    size: stats.size,
  };
}

export default { createZipFromFolder, createZipFromFiles };