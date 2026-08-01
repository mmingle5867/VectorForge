/*
===============================================================================
Document Export Provider Registry
-------------------------------------------------------------------------------
Purpose:
    Registers document export providers and selects the best provider for a
    requested capability and output type.

Architecture:

    Command
        ↓
    Requested capability + output type
        ↓
    Registry finds compatible providers
        ↓
    Selection policy orders candidates
        ↓
    Provider acceptance
        ↓
    Selected provider executes

Important distinctions:

    Capability:
        What work is requested.
        Example: Document.Export

    Output Type:
        What kind of result is wanted.
        Example: text/plain or text/markdown

    Provider:
        A software implementation capable of producing that output.

    Provider Instance:
        A specific installed/running copy of a provider.

This registry is intentionally simple and local for now. Later, SeloBond's
Registry and Discovery services will provide the same behavior dynamically.

===============================================================================
*/

import {
  exportMarkdownDocument,
  type MarkdownExportProviderResult,
} from "@/services/document-markdown-export-service";

import {
  exportTextDocument,
  type TextExportProviderResult,
} from "@/services/document-export-service";

/*
===============================================================================
Shared Provider Types
===============================================================================
*/

/**
 * A normalized result returned by any document export provider.
 *
 * TXT and Markdown providers may have their own internal result interfaces,
 * but the command service should receive one consistent shape.
 */
export interface DocumentExportProviderResult {
  documentId: string;
  documentVersion: number;
  fileName: string;
  filePath: string;
  mimeType: string;
  byteLength: number;
  sha256: string;

  /*
   * Identifies exactly which provider handled the request.
   */
  providerId: string;
  providerInstanceId: string;
}

/**
 * Information supplied to every export provider.
 */
export interface DocumentExportProviderInput {
  ownerId: string;
  documentId: string;
  outputDirectory: string;
  snapshotId: string;
}

/**
 * Provider acceptance response.
 *
 * A provider may be compatible with a request but temporarily unable to
 * execute it because it is busy, offline, missing a dependency, or restricted
 * by policy.
 */
export interface ProviderAcceptance {
  accepted: boolean;
  reason?: string;
}

/**
 * Contract that every document export provider must satisfy.
 *
 * This is similar to an Object Pascal interface or abstract base contract.
 */
export interface DocumentExportProvider {
  providerId: string;
  providerInstanceId: string;
  displayName: string;

  capability: "Document.Export";

  /*
   * MIME output types supported by this provider.
   */
  supportedOutputTypes: string[];

  /*
   * Lower numbers are preferred when no other selection rule overrides them.
   */
  priority: number;

  /*
   * Indicates whether this provider can run without internet access.
   */
  supportsOffline: boolean;

  /**
   * Allows the provider to accept or decline before execution begins.
   */
  accept(
    input: DocumentExportProviderInput,
  ): Promise<ProviderAcceptance>;

  /**
   * Performs the actual export.
   */
  execute(
    input: DocumentExportProviderInput,
  ): Promise<DocumentExportProviderResult>;
}

/*
===============================================================================
TXT Provider Adapter
===============================================================================
*/

/**
 * Adapts the existing TXT export function to the common provider interface.
 */
const localTextProvider: DocumentExportProvider = {
  providerId: "document-export-text-local",
  providerInstanceId: "document-export-text-local-instance-1",
  displayName: "Local TXT Export Provider",

  capability: "Document.Export",
  supportedOutputTypes: ["text/plain"],

  priority: 100,
  supportsOffline: true,

  async accept(): Promise<ProviderAcceptance> {
    /*
     * V1 always accepts.
     *
     * Later this may check:
     * - available disk space
     * - provider queue size
     * - permissions
     * - required dependencies
     * - resource limits
     */
    return {
      accepted: true,
    };
  },

  async execute(
    input: DocumentExportProviderInput,
  ): Promise<DocumentExportProviderResult> {
    const result: TextExportProviderResult =
      await exportTextDocument(input);

    return {
      ...result,
      providerId: this.providerId,
      providerInstanceId: this.providerInstanceId,
    };
  },
};

/*
===============================================================================
Markdown Provider Adapter
===============================================================================
*/

const localMarkdownProvider: DocumentExportProvider = {
  providerId: "document-export-markdown-local",
  providerInstanceId: "document-export-markdown-local-instance-1",
  displayName: "Local Markdown Export Provider",

  capability: "Document.Export",
  supportedOutputTypes: ["text/markdown"],

  priority: 100,
  supportsOffline: true,

  async accept(): Promise<ProviderAcceptance> {
    return {
      accepted: true,
    };
  },

  async execute(
    input: DocumentExportProviderInput,
  ): Promise<DocumentExportProviderResult> {
    const result: MarkdownExportProviderResult =
      await exportMarkdownDocument(input);

    return {
      /*
       * MarkdownExportProviderResult must include documentVersion.
       * Add it to that provider if TypeScript reports it missing.
       */
      ...result,
      providerId: this.providerId,
      providerInstanceId: this.providerInstanceId,
    };
  },
};

/*
===============================================================================
Installed Provider Registry
===============================================================================
*/

/**
 * Current locally installed providers.
 *
 * Later this list will come from SeloBond's Registry Service rather than being
 * declared in source code.
 */
const installedProviders: DocumentExportProvider[] = [
  localTextProvider,
  localMarkdownProvider,
];

/*
===============================================================================
Provider Selection Request
===============================================================================
*/

export interface ResolveDocumentExportProviderRequest {
  capability: "Document.Export";
  requestedOutputType: string;

  /*
   * Preferred:
   * Use this provider when practical, but fallback is allowed.
   */
  preferredProviderId?: string;

  /*
   * Required:
   * Only this provider may be used. If unavailable, resolution fails.
   */
  requiredProviderId?: string;

  /*
   * Defaults to true.
   */
  allowFallbackProviders?: boolean;

  /*
   * Optional policy useful for disconnected/local-first operation.
   */
  requireOfflineSupport?: boolean;
}

/*
===============================================================================
Provider Resolution
===============================================================================
*/

/**
 * Finds and returns the first compatible provider that accepts the work.
 */
export async function resolveDocumentExportProvider(
  request: ResolveDocumentExportProviderRequest,
  providerInput: DocumentExportProviderInput,
): Promise<DocumentExportProvider> {
  const allowFallback = request.allowFallbackProviders ?? true;

  /*
   * Step 1:
   * Find providers implementing the requested capability and output type.
   */
  let candidates = installedProviders.filter((provider) => {
    const supportsCapability =
      provider.capability === request.capability;

    const supportsOutputType =
      provider.supportedOutputTypes.includes(
        request.requestedOutputType,
      );

    const supportsRequiredEnvironment =
      !request.requireOfflineSupport ||
      provider.supportsOffline;

    return (
      supportsCapability &&
      supportsOutputType &&
      supportsRequiredEnvironment
    );
  });

  /*
   * Step 2:
   * A required provider is an absolute constraint.
   */
  if (request.requiredProviderId) {
    candidates = candidates.filter(
      (provider) =>
        provider.providerId === request.requiredProviderId,
    );

    if (candidates.length === 0) {
      throw new Error(
        `Required provider not found or incompatible: ` +
          request.requiredProviderId,
      );
    }
  }

  /*
   * Step 3:
   * Sort preferred provider first, followed by normal provider priority.
   */
  candidates.sort((left, right) => {
    if (
      left.providerId === request.preferredProviderId &&
      right.providerId !== request.preferredProviderId
    ) {
      return -1;
    }

    if (
      right.providerId === request.preferredProviderId &&
      left.providerId !== request.preferredProviderId
    ) {
      return 1;
    }

    return left.priority - right.priority;
  });

  if (candidates.length === 0) {
    throw new Error(
      `No provider supports ${request.capability} with output type ` +
        `${request.requestedOutputType}.`,
    );
  }

  /*
   * Step 4:
   * Ask candidates to accept the work in selection order.
   */
  const rejectionReasons: string[] = [];

  for (const provider of candidates) {
    const acceptance = await provider.accept(providerInput);

    if (acceptance.accepted) {
      return provider;
    }

    rejectionReasons.push(
      `${provider.providerId}: ` +
        (acceptance.reason ?? "Provider declined"),
    );

    /*
     * A required provider may not fall back.
     */
    if (request.requiredProviderId) {
      break;
    }

    /*
     * A caller may explicitly prevent fallback.
     */
    if (!allowFallback) {
      break;
    }
  }

  throw new Error(
    `All compatible providers declined the request. ` +
      rejectionReasons.join("; "),
  );
}