/**
 * =============================================================================
 * Capability: Documentation.Describe
 * File: register-local-documentation.ts
 * Architectural Role: Local Manifest Registration
 * =============================================================================
 *
 * Registers manifests published by capabilities installed inside VectorForge.
 *
 * Later, SEMA Discovery may load manifests dynamically from local, network,
 * web, and cloud capability providers.
 * =============================================================================
 */

import {
  registerCapabilityManifest,
} from './registry';

import {
  skuGenerateManifest,
} from '@/capabilities/sku-generate/manifest';

let registered = false;

export function registerLocalCapabilityManifests(): void {
  if (registered) {
    return;
  }

  registerCapabilityManifest(
    skuGenerateManifest,
  );

  registered = true;
}