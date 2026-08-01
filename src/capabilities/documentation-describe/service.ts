/**
 * =============================================================================
 * Capability: Documentation.Describe
 * File: service.ts
 * Architectural Role: Documentation Orchestrator
 * =============================================================================
 *
 * WHO
 * ---
 * Used by SeloDoc, Discovery, application help, developer tools, and tests.
 *
 * WHAT
 * ----
 * Retrieves a Capability Manifest and returns its documentation section,
 * filtered for the requested audience.
 *
 * WHEN
 * ----
 * Called whenever documentation is requested for a registered capability.
 *
 * WHY
 * ---
 * Capabilities publish complete manifests, but Documentation.Describe exposes
 * only the documentation portion appropriate for the requested audience.
 *
 * HOW
 * ---
 * 1. Retrieve the Capability Manifest.
 * 2. Read its documentation section.
 * 3. Filter documentation sections by visibility.
 * 4. Return the filtered documentation result.
 *
 * DOES NOT DO
 * -----------
 * - Authenticate callers
 * - Enforce SEMA permissions
 * - Return provider or security metadata
 * - Read source-code comments
 * =============================================================================
 */

import {
  getCapabilityManifest,
} from './registry';

import type {
  DocumentationRequest,
  DocumentationResult,
  ManifestVisibility,
} from './types';

const visibilityRank:
  Record<ManifestVisibility, number> = {
    public: 1,
    partner: 2,
    organization: 3,
    internal: 4,
  };

function canView(
  sectionVisibility: ManifestVisibility,
  requestedAudience: ManifestVisibility,
): boolean {
  return (
    visibilityRank[sectionVisibility] <=
    visibilityRank[requestedAudience]
  );
}

export function describeDocumentation(
  request: DocumentationRequest,
): DocumentationResult {
  const manifest =
    getCapabilityManifest(request.capabilityId);

  const includedSections =
    manifest.documentation.sections
      .filter((section) =>
        canView(
          section.visibility,
          request.audience,
        ),
      )
      .sort(
        (left, right) =>
          (left.displayOrder ?? 0) -
          (right.displayOrder ?? 0),
      );

  const includedSectionIds =
    includedSections.map(
      (section) => section.id,
    );

  const excludedSectionIds =
    manifest.documentation.sections
      .filter(
        (section) =>
          !includedSectionIds.includes(section.id),
      )
      .map((section) => section.id);

  return {
    capabilityId: manifest.capabilityId,
    version: manifest.version,
    requestedAudience: request.audience,

    documentation: {
      ...manifest.documentation,
      sections: includedSections,
    },

    includedSectionIds,
    excludedSectionIds,
  };
}