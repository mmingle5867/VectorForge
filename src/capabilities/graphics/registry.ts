import type { Prisma } from '@prisma/client';

import { registerCoreCapability, resolveCoreCapability } from '@/services/sema-core';

export const GRAPHICS_CAPABILITIES = {
  rasterBlur: 'sema.graphics.raster.blur',
  rasterUpscale: 'sema.graphics.raster.upscale',
  rasterTransform: 'sema.graphics.raster.transform',
  rasterComposite: 'sema.graphics.raster.composite',
  vectorTrace: 'sema.graphics.vector.trace',
  vectorOptimize: 'sema.graphics.vector.optimize',
} as const;

export type GraphicsCapabilityKey =
  (typeof GRAPHICS_CAPABILITIES)[keyof typeof GRAPHICS_CAPABILITIES];

type LocalGraphicsProvider = {
  capabilityKey: GraphicsCapabilityKey;
  displayName: string;
  description: string;
  providerKey: string;
};

const LOCAL_GRAPHICS_PROVIDERS: readonly LocalGraphicsProvider[] = [
  {
    capabilityKey: GRAPHICS_CAPABILITIES.rasterBlur,
    displayName: 'Blur Raster',
    description: 'Applies a non-destructive blur while creating a raster working version.',
    providerKey: 'vectorforge.provider.sharp',
  },
  {
    capabilityKey: GRAPHICS_CAPABILITIES.rasterUpscale,
    displayName: 'Upscale Raster',
    description: 'Creates a larger raster working version using a configured upscale strategy.',
    providerKey: 'vectorforge.provider.sharp',
  },
  {
    capabilityKey: GRAPHICS_CAPABILITIES.rasterTransform,
    displayName: 'Transform Raster',
    description: 'Reads raster metadata and performs local raster conversion, resize, and export transforms.',
    providerKey: 'vectorforge.provider.sharp',
  },
  {
    capabilityKey: GRAPHICS_CAPABILITIES.rasterComposite,
    displayName: 'Composite Raster',
    description: 'Composes configured raster layers into one rendered raster output.',
    providerKey: 'vectorforge.provider.sharp',
  },
  {
    capabilityKey: GRAPHICS_CAPABILITIES.vectorTrace,
    displayName: 'Trace Raster to Vector',
    description: 'Creates an SVG vector representation from an approved raster input.',
    providerKey: 'vectorforge.provider.wasm-vtracer',
  },
  {
    capabilityKey: GRAPHICS_CAPABILITIES.vectorOptimize,
    displayName: 'Optimize SVG',
    description: 'Optimizes an SVG while preserving the requested vector output semantics.',
    providerKey: 'vectorforge.provider.svgo',
  },
] as const;

function getLocalProvider(capabilityKey: GraphicsCapabilityKey) {
  const provider = LOCAL_GRAPHICS_PROVIDERS.find((candidate) => candidate.capabilityKey === capabilityKey);
  if (!provider) throw new Error(`No local provider is declared for ${capabilityKey}`);
  return provider;
}

/**
 * Resolves a graphics intent before VectorForge calls the locally selected
 * provider implementation. The first invocation registers the local provider;
 * later discovery/policy rules can replace that selection without changing the
 * artwork workflow call sites.
 */
export async function resolveLocalGraphicsCapability(
  capabilityKey: GraphicsCapabilityKey,
  context: { actorId?: string | null; workspaceId?: string | null } = {}
) {
  const provider = getLocalProvider(capabilityKey);
  await registerCoreCapability({
    ...provider,
    version: '1.0.0',
    metadata: {
      localFirst: true,
      implementationBoundary: 'VectorForge graphics provider',
      providerRuntime: provider.providerKey,
    } as Prisma.InputJsonValue,
  });
  return resolveCoreCapability({ capabilityKey, ...context });
}

export async function registerLocalGraphicsCapabilities() {
  for (const provider of LOCAL_GRAPHICS_PROVIDERS) {
    await registerCoreCapability({
      ...provider,
      version: '1.0.0',
      metadata: {
        localFirst: true,
        implementationBoundary: 'VectorForge graphics provider',
        providerRuntime: provider.providerKey,
      } as Prisma.InputJsonValue,
    });
  }
  return LOCAL_GRAPHICS_PROVIDERS;
}

