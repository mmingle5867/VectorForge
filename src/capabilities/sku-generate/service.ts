import {
  DEFAULT_SKU_PROVIDER_ID,
  getSkuProvider,
  listSkuProviders,
} from './registry';
import type {
  SkuGenerationInput,
  SkuGenerationResult,
  SkuProvider,
} from './types';

export async function generateSkuWithProvider(
  input: SkuGenerationInput,
  providerId: string = DEFAULT_SKU_PROVIDER_ID
): Promise<SkuGenerationResult> {
  if (!input.baseName.trim()) {
    throw new Error('A base name is required to generate a SKU');
  }

  if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber < 1) {
    throw new Error('SKU sequence number must be a positive integer');
  }

  const provider = getSkuProvider(providerId);
  return provider.generate(input);
}

export function getAvailableSkuProviders(): SkuProvider[] {
  return listSkuProviders();
}