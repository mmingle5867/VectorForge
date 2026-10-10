import { registerCoreCapability } from '@/services/sema-core';

export const FOUNDATION_ASSET_CATALOG_CAPABILITY = 'sema.foundation.asset.discover';

const providerUrl = () => (process.env.VECTORFORGE_SEMA_PROVIDER_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

/** Registers VectorForge as a provider of a filtered, reference-only Asset catalog. */
export async function registerFoundationAssetCatalogCapability() {
  return registerCoreCapability({
    capabilityKey: FOUNDATION_ASSET_CATALOG_CAPABILITY,
    displayName: 'Discover Approved Assets',
    description: 'Returns approved asset and version references for authorized downstream applications without exposing VectorForge files, paths, or private tables.',
    providerKey: 'vectorforge.provider.foundation-asset-catalog',
    version: '1.0.0',
    metadata: {
      contractVersion: '1.0.0',
      endpointUrl: `${providerUrl()}/api/sema/foundation/assets`,
      transport: 'http-json',
      localFirst: true,
      referenceOnly: true,
      defaultVersionPolicy: 'APPROVAL_REQUIRED',
      excludes: ['original-files', 'working-files', 'absolute-paths', 'private-diagnostics'],
    },
  });
}
