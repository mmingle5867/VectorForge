/** Run only after the one-time renumbering has completed successfully. */
import { getSemaCoreIdentityState } from '../services/sema-core-identity';
import { registerCoreCapability } from '../services/sema-core';
import { registerLocalGraphicsCapabilities } from '../capabilities/graphics/registry';
import prisma from '../lib/prisma';

const capabilities = [
  ['sema.document.create-text', 'Create Text Document', 'Creates a plain-text or Markdown Document reference.'],
] as const;

async function main() {
  const state = await getSemaCoreIdentityState();
  await prisma.semaCoreCapability.updateMany({
    where: {
      capabilityKey: {
        in: [
          'sema.graphics.smooth-raster',
          'sema.graphics.upscale-image',
          'sema.graphics.vectorize-image',
          'sema.graphics.composite-raster',
        ],
      },
    },
    data: { status: 'RETIRED' },
  });
  const graphicsCapabilities = await registerLocalGraphicsCapabilities();
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
  console.log(`SEMA Core ${state.installationId} bootstrapped with ${graphicsCapabilities.length + capabilities.length} local capabilities.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
