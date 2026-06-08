/**
 * VectorForge - SKU Generation Service
 * Generates SKUs in format: DIGI-001-[basename]-[sequencenumber]
 * Also creates blank .txt files named after the SKU.
 */

import path from 'path';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';
import { generateSku } from '@/lib/utils';
import type { GeneratedFile } from '@/lib/types';

/**
 * Generate a SKU and create the corresponding blank .txt file.
 * The blank text file is named exactly after the SKU (e.g., DIGI-001-widget-001.txt).
 */
export async function generateSkuFile(
  outputDir: string,
  baseName: string,
  sequenceNumber: number
): Promise<{ sku: string; file: GeneratedFile }> {
  const sku = generateSku(baseName, sequenceNumber);
  const skuFilename = `${sku}.txt`;
  const skuFilePath = path.join(outputDir, skuFilename);

  // Create blank text file named after the SKU
  await fs.writeFile(skuFilePath, '', 'utf-8');

  logger.info(`SKU: Generated ${sku}`, { skuFilePath });

  return {
    sku,
    file: {
      type: 'sku_file',
      filename: skuFilename,
      path: skuFilePath,
      size: 0,
    },
  };
}

/**
 * Validate SKU format.
 */
export function isValidSku(sku: string): boolean {
  const pattern = /^DIGI-001-[a-z0-9-]+-\d{3}$/;
  return pattern.test(sku);
}

export default { generateSkuFile, isValidSku };