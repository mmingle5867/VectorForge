import type {
  SkuGenerationInput,
  SkuGenerationResult,
  SkuProvider,
} from '../types';

function sanitizeCode(value: string, fallback: string, maxLength: number): string {
  const sanitized = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, maxLength);

  return sanitized || fallback;
}

export const structuredSkuProvider: SkuProvider = {
  id: 'vectorforge.structured-sku',
  name: 'Structured VectorForge SKU',
  strategyId: 'app-type-sequence-profile-v1',
  description:
    'Creates a short structured SKU using application, item type, sequence, and profile codes.',

  async generate(input: SkuGenerationInput): Promise<SkuGenerationResult> {
    const appCode = sanitizeCode(input.appCode || 'VF', 'VF', 4);
    const itemType = sanitizeCode(input.itemType || 'ART', 'ART', 4);
    const profileType = sanitizeCode(input.profileType || 'DIG', 'DIG', 4);
    const sequence = String(input.sequenceNumber).padStart(5, '0');

    const sku = `${appCode}-${itemType}-${sequence}-${profileType}`;

    return {
      sku,
      providerId: this.id,
      strategyId: this.strategyId,
      generatedAt: new Date().toISOString(),
      components: {
        appCode,
        itemType,
        sequenceNumber: input.sequenceNumber,
        profileType,
      },
    };
  },
};