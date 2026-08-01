/**
 * VectorForge SKU file generation.
 *
 * SKU values are generated through the SKU.Generate provider framework.
 * This service also creates the blank SKU-named .txt marker file used by
 * existing VectorForge packages.
 */

import path from 'path';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';
import type { GeneratedFile } from '@/lib/types';
import { generateSkuWithProvider } from '@/capabilities/sku-generate/service';
import { DEFAULT_SKU_PROVIDER_ID } from '@/capabilities/sku-generate/registry';
import type {
  SkuGenerationInput,
  SkuGenerationResult,
} from '@/capabilities/sku-generate/types';

export interface GenerateSkuFileOptions
  extends Partial<
    Omit<SkuGenerationInput, 'baseName' | 'sequenceNumber'>
  > {
  providerId?: string;
}

export interface GeneratedSkuFileResult {
  sku: string;
  file: GeneratedFile;
  providerId: string;
  strategyId: string;
  generatedAt: string;
  components: Record<string, string | number>;
}

/**
 * Generate a SKU and create the corresponding blank .txt file.
 *
 * Existing calls remain valid:
 *
 * generateSkuFile(outputDir, baseName, sequenceNumber)
 */
export async function generateSkuFile(
  outputDir: string,
  baseName: string,
  sequenceNumber: number,
  options: GenerateSkuFileOptions = {}
): Promise<GeneratedSkuFileResult> {
  const {
    providerId = DEFAULT_SKU_PROVIDER_ID,
    ...additionalInput
  } = options;

  const result = await generateSkuWithProvider(
    {
      baseName,
      sequenceNumber,
      ...additionalInput,
    },
    providerId
  );

  const skuFilename = `${result.sku}.txt`;
  const skuFilePath = path.join(outputDir, skuFilename);

  await fs.writeFile(skuFilePath, '', 'utf-8');

  logger.info(`SKU: Generated ${result.sku}`, {
    skuFilePath,
    providerId: result.providerId,
    strategyId: result.strategyId,
  });

  return {
    ...result,
    file: {
      type: 'sku_file',
      filename: skuFilename,
      path: skuFilePath,
      size: 0,
    },
  };
}

/**
 * Validate the original VectorForge SKU format.
 *
 * This remains unchanged for compatibility. Provider-specific validation
 * can be added to the provider contract later.
 */
export function isValidSku(sku: string): boolean {
  const pattern = /^DIGI-001-[a-z0-9-]+-\d{3}$/;
  return pattern.test(sku);
}

/**
 * Generate a SKU result without creating a marker file.
 *
 * This is useful for previews, provider comparisons, and future
 * Consensus Execution tests.
 */
export async function previewSku(
  baseName: string,
  sequenceNumber: number,
  options: GenerateSkuFileOptions = {}
): Promise<SkuGenerationResult> {
  const {
    providerId = DEFAULT_SKU_PROVIDER_ID,
    ...additionalInput
  } = options;

  return generateSkuWithProvider(
    {
      baseName,
      sequenceNumber,
      ...additionalInput,
    },
    providerId
  );
}