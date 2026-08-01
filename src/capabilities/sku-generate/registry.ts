import { currentVectorForgeSkuProvider } from './providers/current-vectorforge';
import { structuredSkuProvider } from './providers/structured';
import type { SkuProvider } from './types';

export const DEFAULT_SKU_PROVIDER_ID = currentVectorForgeSkuProvider.id;

const providers = new Map<string, SkuProvider>();

export function registerSkuProvider(provider: SkuProvider): void {
  if (providers.has(provider.id)) {
    throw new Error(`SKU provider "${provider.id}" is already registered`);
  }

  providers.set(provider.id, provider);
}

export function getSkuProvider(providerId: string): SkuProvider {
  const provider = providers.get(providerId);

  if (!provider) {
    throw new Error(`Unknown SKU provider "${providerId}"`);
  }

  return provider;
}

export function listSkuProviders(): SkuProvider[] {
  return Array.from(providers.values());
}

registerSkuProvider(currentVectorForgeSkuProvider);
registerSkuProvider(structuredSkuProvider);