/** Run only after the one-time renumbering has completed successfully. */
import { getSemaCoreIdentityState } from '../services/sema-core-identity';
import { registerCoreCapability } from '../services/sema-core';
import { registerLocalGraphicsCapabilities } from '../capabilities/graphics/registry';
import { registerFoundationAssetCatalogCapability } from '../capabilities/foundation-asset-catalog/registry';

const capabilities = [
  ['sema.document.create-text', 'Create Text Document', 'Creates a plain-text or Markdown Document reference.'],
] as const;

async function main() {
  const state = await getSemaCoreIdentityState();
  const graphicsCapabilities = await registerLocalGraphicsCapabilities();
  await registerFoundationAssetCatalogCapability();
  for (const [capabilityKey, displayName, description] of capabilities) {
    await registerCoreCapability({
      capabilityKey,
      displayName,
      description,
      providerKey: 'vectorforge.local.reference',
      version: '1.0.0',
      metadata: { localFirst: true, referenceApplication: 'VectorForge' },
    });
  }
  console.log(`SEMA Core ${state.installationId} bootstrapped with ${graphicsCapabilities.length + capabilities.length + 1} local capabilities.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
