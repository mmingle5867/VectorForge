import { generateSku } from '@/lib/utils';
import type {
  SkuGenerationInput,
  SkuGenerationResult,
  SkuProvider,
} from '../types';

export const currentVectorForgeSkuProvider: SkuProvider = {
  id: 'vectorforge.current-sku',
  name: 'Current VectorForge SKU',
  strategyId: 'digi-basename-sequence-v1',
  description:
    'Preserves the existing VectorForge SKU format: DIGI-001-[basename]-[sequence].',

  async generate(input: SkuGenerationInput): Promise<SkuGenerationResult> {
    const sku = generateSku(input.baseName, input.sequenceNumber);

    return {
      sku,
      providerId: this.id,
      strategyId: this.strategyId,
      generatedAt: new Date().toISOString(),
      components: {
        prefix: 'DIGI',
        formatVersion: '001',
        baseName: input.baseName,
        sequenceNumber: input.sequenceNumber,
      },
    };
  },
};