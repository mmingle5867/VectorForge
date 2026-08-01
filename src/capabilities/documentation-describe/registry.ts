/**
 * =============================================================================
 * Capability: Documentation.Describe
 * File: registry.ts
 * Architectural Role: Manifest Registry
 * =============================================================================
 *
 * WHO
 * ---
 * Used by Documentation.Describe and future Discovery tools.
 *
 * WHAT
 * ----
 * Stores published Capability Manifests by capability ID.
 *
 * WHEN
 * ----
 * Called when a manifest is registered or retrieved.
 *
 * WHY
 * ---
 * Keeps manifest discovery separate from capability implementation.
 *
 * HOW
 * ---
 * A Map connects each capability ID to one CapabilityManifest.
 *
 * TYPESCRIPT NOTES
 * ----------------
 * Map<K, V>
 *   A lookup table where K is the key type and V is the value type.
 * =============================================================================
 */

import type { CapabilityManifest } from './types';

const manifestRegistry =
  new Map<string, CapabilityManifest>();

export function registerCapabilityManifest(
  manifest: CapabilityManifest,
): void {
  if (manifestRegistry.has(manifest.capabilityId)) {
    throw new Error(
      `A manifest is already registered for "${manifest.capabilityId}".`,
    );
  }

  manifestRegistry.set(
    manifest.capabilityId,
    manifest,
  );
}

export function getCapabilityManifest(
  capabilityId: string,
): CapabilityManifest {
  const manifest =
    manifestRegistry.get(capabilityId);

  if (!manifest) {
    throw new Error(
      `No manifest is registered for "${capabilityId}".`,
    );
  }

  return manifest;
}

export function listCapabilityManifests():
  CapabilityManifest[] {
  return Array.from(manifestRegistry.values());
}