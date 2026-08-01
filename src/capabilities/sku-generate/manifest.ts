/**
 * =============================================================================
 * Capability: SKU.Generate
 * File: manifest.ts
 * Architectural Role: Published Capability Manifest
 * =============================================================================
 *
 * WHO
 * ---
 * Used by Documentation.Describe, Discovery, SeloDoc, developer tools,
 * certification tools, and future AI assistants.
 *
 * WHAT
 * ----
 * Declares the identity, providers, inputs, outputs, permissions,
 * dependencies, and intentionally published documentation for SKU.Generate.
 *
 * WHEN
 * ----
 * Loaded when local capability manifests are registered.
 *
 * WHY
 * ---
 * Makes SKU.Generate self-describing without exposing private source comments
 * or internal developer notes.
 *
 * HOW
 * ---
 * This object satisfies the CapabilityManifest contract.
 *
 * TYPESCRIPT NOTES
 * ----------------
 * `: CapabilityManifest`
 *   Requires this object to match the CapabilityManifest contract.
 *
 * `readonly` fields
 *   Prevent consumers from modifying published manifest data accidentally.
 * =============================================================================
 */

import type {
  CapabilityManifest,
} from '@/capabilities/documentation-describe/types';

export const skuGenerateManifest: CapabilityManifest = {
  capabilityId: 'SKU.Generate',
  subjectType: 'capability',
  version: '1.0.0',
  category: 'Identification',
  visibility: 'public',

  description:
    'Generates standardized SKU values through selectable providers.',

  inputs: [
    {
      name: 'baseName',
      type: 'string',
      description:
        'Source name used by providers when constructing the SKU.',
      required: true,
    },
    {
      name: 'sequenceNumber',
      type: 'number',
      description:
        'Positive sequence number used to distinguish generated SKUs.',
      required: true,
    },
    {
      name: 'providerId',
      type: 'string',
      description:
        'Optional identifier of the SKU provider to execute.',
      required: false,
    },
    {
      name: 'itemType',
      type: 'string',
      description:
        'Optional item-type code used by structured providers.',
      required: false,
    },
    {
      name: 'profileType',
      type: 'string',
      description:
        'Optional profile code such as DIG or CNC.',
      required: false,
    },
  ],

  outputs: [
    {
      name: 'sku',
      type: 'string',
      description:
        'The generated SKU value.',
    },
    {
      name: 'providerId',
      type: 'string',
      description:
        'The provider that generated the SKU.',
    },
    {
      name: 'strategyId',
      type: 'string',
      description:
        'The provider strategy used to construct the SKU.',
    },
    {
      name: 'components',
      type: 'Record<string, string | number>',
      description:
        'The component values used to construct the SKU.',
    },
  ],

  providers: [
    {
      providerId: 'vectorforge.current-sku',
      displayName: 'Current VectorForge SKU',
      strategyId: 'digi-basename-sequence-v1',
      description:
        'Preserves the existing DIGI-001-[basename]-[sequence] format.',
      isDefault: true,
    },
    {
      providerId: 'vectorforge.structured-sku',
      displayName: 'Structured VectorForge SKU',
      strategyId: 'app-type-sequence-profile-v1',
      description:
        'Generates a structured application, item type, sequence, and profile SKU.',
      isDefault: false,
    },
  ],

  permissions: [
    {
      permissionId: 'SKU.Generate',
      description:
        'Allows a caller to request generation of a SKU.',
      requirement: 'required',
    },
    {
      permissionId: 'Inventory.Write',
      description:
        'SKU.Generate does not directly modify inventory records.',
      requirement: 'not-requested',
    },
  ],

  dependencies: [
    'SKU provider registry',
    'SKU provider contract',
  ],

  consumers: [
    'VectorForge package finalization',
    'VectorForge processing worker',
    'Future SEMA applications',
    'Future SKU comparison interfaces',
  ],

  documentation: {
    title: 'SKU Generation',

    summary:
      'Generates standardized SKU values through selectable providers.',

    purpose:
      'Provide one stable SKU-generation interface without coupling callers to a specific SKU format or implementation.',

    architecturalRole:
      'Capability Orchestrator',

    responsibilities: [
      'Validate SKU-generation requests',
      'Resolve the requested SKU provider',
      'Invoke the selected provider',
      'Return a standardized SKU result',
      'Identify the provider and strategy used',
    ],

    nonResponsibilities: [
      'Store inventory records',
      'Assign ownership of products',
      'Create marketplace listings',
      'Write package files directly',
      'Choose a provider without an applicable selection rule',
    ],

    examples: [
      'Generate DIGI-001-birthday-tractor-007 using the current VectorForge provider.',
      'Generate VF-ART-00007-DIG using the structured provider.',
    ],

    sections: [
      {
        id: 'when-to-use',
        title: 'When to use',
        content:
          'Use SKU.Generate whenever an application needs a SKU without depending directly on a particular SKU format.',
        visibility: 'public',
        displayOrder: 10,
      },
      {
        id: 'available-providers',
        title: 'Initial providers',
        content:
          'The initial implementation includes the Current VectorForge SKU provider and the Structured SKU provider.',
        visibility: 'public',
        displayOrder: 20,
      },
      {
        id: 'compatibility',
        title: 'VectorForge compatibility',
        content:
          'The Current VectorForge provider preserves the original DIGI-001-[basename]-[sequence] format so existing package behavior remains unchanged.',
        visibility: 'organization',
        displayOrder: 30,
      },
      {
        id: 'future-consensus',
        title: 'Future consensus use',
        content:
          'Multiple SKU providers may later run together under a human-review consensus strategy so users can compare candidate SKUs before selection.',
        visibility: 'internal',
        displayOrder: 40,
      },
    ],
  },
};