/**
 * =============================================================================
 * Capability: Documentation.Describe
 * File: types.ts
 * Architectural Role: Contract
 * =============================================================================
 *
 * WHO USES THIS FILE
 * ------------------
 * Capability manifests, Documentation.Describe, Discovery, SeloDoc,
 * certification tools, developer tools, and future AI assistants.
 *
 * WHAT THIS FILE DOES
 * -------------------
 * Defines the standard structure of a published Capability Manifest and the
 * request/result contracts used to retrieve its documentation.
 *
 * WHEN IT IS USED
 * ---------------
 * Whenever a capability publishes structured information about itself or
 * another component requests its intentionally exposed documentation.
 *
 * WHERE IT FITS
 * -------------
 * This is the shared contract layer. It defines data shapes only.
 * It does not register, retrieve, filter, authorize, or display manifests.
 *
 * WHY IT EXISTS
 * -------------
 * SEMA components must explicitly declare what information they expose.
 * Source-code comments and private developer notes are not automatically
 * included in published manifests.
 *
 * HOW IT WORKS
 * ------------
 * Each capability creates an object satisfying CapabilityManifest.
 * Documentation.Describe reads the documentation section and filters it for
 * the requested audience.
 *
 * DOES NOT DO
 * -----------
 * - Read source-code comments
 * - Authorize users
 * - Execute capabilities
 * - Register providers
 * - Store manifests in a database
 *
 * TYPESCRIPT NOTES
 * ----------------
 * `type A = 'x' | 'y'`
 *   A union type. The value must be one of the listed choices.
 *
 * `readonly string[]`
 *   A list that callers should not modify.
 *
 * `interface`
 *   A contract describing the required shape of an object.
 *
 * `?`
 *   Marks an optional property.
 *
 * HISTORY
 * -------
 * Created:
 *   2026-07-31
 *
 * Expanded:
 *   2026-07-31
 *
 * Reason:
 *   Evolved from documentation-only metadata into the first Capability
 *   Manifest contract while preserving Documentation.Describe as a separate
 *   consumer of the documentation portion.
 * =============================================================================
 */

/**
 * Controls the intended audience for published information.
 *
 * This declares exposure intent. Actual access control will later be enforced
 * through SEMA permissions and execution context.
 */
export type ManifestVisibility =
  | 'public'
  | 'partner'
  | 'organization'
  | 'internal';

/**
 * Identifies the architectural role of the manifest owner.
 */
export type ManifestSubjectType =
  | 'application'
  | 'capability'
  | 'provider'
  | 'service'
  | 'command'
  | 'event'
  | 'result'
  | 'object'
  | 'connector';

/**
 * Describes one input accepted by a capability.
 */
export interface CapabilityInputDefinition {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

/**
 * Describes one output returned by a capability.
 */
export interface CapabilityOutputDefinition {
  name: string;
  type: string;
  description: string;
}

/**
 * Describes one provider advertised by a capability.
 */
export interface CapabilityProviderDefinition {
  providerId: string;
  displayName: string;
  strategyId?: string;
  description: string;
  isDefault?: boolean;
}

/**
 * Describes one permission declared by a capability.
 */
export interface CapabilityPermissionDefinition {
  permissionId: string;
  description: string;
  requirement:
    | 'required'
    | 'optional'
    | 'not-requested';
}

/**
 * One independently filterable documentation section.
 */
export interface ManifestDocumentationSection {
  id: string;
  title: string;
  content: string;
  visibility: ManifestVisibility;
  displayOrder?: number;
}

/**
 * Documentation deliberately published within a Capability Manifest.
 */
export interface ManifestDocumentation {
  title: string;
  summary: string;
  purpose: string;
  architecturalRole: string;

  responsibilities: readonly string[];
  nonResponsibilities: readonly string[];

  examples?: readonly string[];

  sections: readonly ManifestDocumentationSection[];
}

/**
 * Standard published identity and metadata for one capability.
 */
export interface CapabilityManifest {
  /**
   * Stable machine-readable capability identity.
   * Example: SKU.Generate
   */
  capabilityId: string;

  /**
   * Type of component publishing the manifest.
   */
  subjectType: ManifestSubjectType;

  /**
   * Manifest and capability version.
   */
  version: string;

  /**
   * Broad grouping used by Discovery and documentation tools.
   * Example: Identification, Documents, Graphics, Commerce.
   */
  category: string;

  /**
   * Visibility of the manifest itself.
   */
  visibility: ManifestVisibility;

  /**
   * Human-readable capability description.
   */
  description: string;

  /**
   * Standardized capability inputs.
   */
  inputs: readonly CapabilityInputDefinition[];

  /**
   * Standardized capability outputs.
   */
  outputs: readonly CapabilityOutputDefinition[];

  /**
   * Providers currently advertised by this capability.
   */
  providers: readonly CapabilityProviderDefinition[];

  /**
   * Permissions deliberately declared by this capability.
   */
  permissions: readonly CapabilityPermissionDefinition[];

  /**
   * Other capabilities, services, or contracts required by this capability.
   */
  dependencies: readonly string[];

  /**
   * Applications or capabilities known to consume this capability.
   */
  consumers?: readonly string[];

  /**
   * Intentionally published documentation.
   */
  documentation: ManifestDocumentation;
}

/**
 * Request used to retrieve documentation from one manifest.
 */
export interface DocumentationRequest {
  capabilityId: string;
  audience: ManifestVisibility;
}

/**
 * Filtered documentation returned to a caller.
 */
export interface DocumentationResult {
  capabilityId: string;
  version: string;
  requestedAudience: ManifestVisibility;

  documentation: ManifestDocumentation;

  includedSectionIds: readonly string[];
  excludedSectionIds: readonly string[];
}