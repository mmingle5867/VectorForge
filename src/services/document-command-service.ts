/*
===============================================================================
Document Command Service
-------------------------------------------------------------------------------
Purpose:
    Implements the first complete SEMA-style execution flow in VectorForge.

Execution model:

    ExportDocumentCommand
        ↓
    DocumentExportEvent
        ↓
    Diagnostic Log Entries
        ↓
    Text Export Provider
        ↓
    ExportDocumentResult

Important:
    These structures are currently held in memory and returned to the caller.
    Persistence of Commands, Events, Results, and Diagnostic Objects will be
    added after this execution model has been proven.

===============================================================================
*/

import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  resolveDocumentExportProvider,
  type DocumentExportProviderResult,
} from "@/services/document-export-provider-registry";

/*
===============================================================================
Shared SEMA Types
===============================================================================
*/

/**
 * Operational state of an Event.
 *
 * This answers:
 *     "What is happening with execution?"
 *
 * It is intentionally separate from BusinessOutcome.
 */
export type ExecutionState =
  | "CREATED"
  | "QUEUED"
  | "RUNNING"
  | "WAITING"
  | "PAUSED"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

/**
 * Business meaning of the completed work.
 *
 * This answers:
 *     "What did the work accomplish?"
 */
export type BusinessOutcome =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "FAILED"
  | "REQUIRES_REVIEW"
  | "DEFERRED"
  | "NO_ACTION"
  | "CANCELLED";

/**
 * Diagnostic severity.
 */
export type DiagnosticSeverity =
  | "TRACE"
  | "DEBUG"
  | "INFORMATION"
  | "WARNING"
  | "ERROR"
  | "CRITICAL";

/**
 * One diagnostic record produced during execution.
 *
 * Later, these entries will belong to a separate Diagnostic Object or
 * Log Collection stored through SeloBond.
 */
export interface DiagnosticLogEntry {
  logEntryId: string;
  timestamp: string;
  severity: DiagnosticSeverity;
  category: string;
  source: string;
  message: string;
  relatedReferenceIds: string[];
  metadata: Record<string, string | number | boolean | null>;
}

/*
===============================================================================
Command
===============================================================================
*/

/**
 * Requests the capability:
 *
 *     Document.ExportText
 *
 * The Command expresses intent. It does not perform the export itself.
 */
export interface ExportDocumentCommand {
  commandId: string;
  commandType: "DOCUMENT.EXPORT";
  capability: "Document.Export";
  
  ownerId: string;
  workspaceId: string;
  documentId: string;
  requestedOutputType: string;

  providerResolutionMode:
    | "DYNAMIC"
    | "BOUND"
    | "POLICY_ROUTED"
    | "CONSENSUS";

  preferredProviderId?: string;

  requiredProviderId?: string;

  allowFallbackProviders: boolean;

  requestedBy: string;
  submittedAt: string;

  outputDirectory: string;
}

/*
===============================================================================
Event
===============================================================================
*/

/**
 * Tracks execution of the ExportDocumentCommand.
 */
export interface DocumentExportEvent {
  eventId: string;
  eventType: "DOCUMENT.EXPORT";

  originatingCommandId: string;
  rootCommandId: string;

  executionState: ExecutionState;
  executionReason?: string;

  createdAt: string;
  startedAt?: string;
  completedAt?: string;

  /*
   * Progress is optional because some providers may not know an exact
   * percentage. For this small export we can report 0, 25, 75, and 100.
   */
  progressPercent: number;

  /*
   * References to Diagnostic Objects will replace embedded entries later.
   * Keeping them here temporarily makes the full flow easy to inspect.
   */
  diagnosticLogEntries: DiagnosticLogEntry[];
}

/*
===============================================================================
Immutable Result Reference
===============================================================================
*/

/**
 * Describes an immutable file snapshot produced by the provider.
 *
 * The combination of:
 *     unique file path
 *     document version
 *     SHA-256 hash
 *
 * ensures the Result permanently identifies what was produced.
 */
export interface ImmutableFileReference {
  referenceType: "IMMUTABLE_FILE_SNAPSHOT";
  referenceId: string;

  fileName: string;
  filePath: string;
  mimeType: string;
  byteLength: number;
  sha256: string;

  sourceDocumentId: string;
  sourceDocumentVersion: number;
  createdAt: string;
}

/*
===============================================================================
Result
===============================================================================
*/

/**
 * Permanent outcome of the Event.
 */
export interface ExportDocumentResult {
  resultId: string;
  resultType: "DOCUMENT.EXPORT";

  originatingCommandId: string;
  originatingEventId: string;

  businessOutcome: BusinessOutcome;
  businessReason?: string;
  summary: string;

  producedReferences: ImmutableFileReference[];

  createdAt: string;

  /*
   * Small, immediately useful values may be included inline.
   */
  inlineData: {
    fileCount: number;
    totalBytes: number;
  };
}

/*
===============================================================================
Combined Execution Response
===============================================================================
*/

/**
 * Temporary convenience structure returned to our test client.
 *
 * In the final SeloBond architecture, Commands, Events, Results, and
 * Diagnostic Objects will each have independent storage and references.
 */
export interface DocumentCommandExecution {
  command: ExportDocumentCommand;
  event: DocumentExportEvent;
  result: ExportDocumentResult;
}

/*
===============================================================================
Helper Functions
===============================================================================
*/

/**
 * Generates a short readable identifier.
 *
 * randomUUID() returns a globally unique value such as:
 *
 *     43a4f92d-f778-40df-b034-e18dc64b13f7
 *
 * Removing hyphens and shortening it keeps test output easier to read.
 * The final SEMA ID generator will later replace this helper.
 */
function createTemporaryId(prefix: string): string {
  const uniquePart = randomUUID().replaceAll("-", "").slice(0, 16);
  return `${prefix}-${uniquePart}`;
}

/**
 * Creates a standardized diagnostic log entry.
 */
function createLogEntry(input: {
  severity: DiagnosticSeverity;
  category: string;
  source: string;
  message: string;
  relatedReferenceIds?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}): DiagnosticLogEntry {
  return {
    logEntryId: createTemporaryId("LOG"),
    timestamp: new Date().toISOString(),
    severity: input.severity,
    category: input.category,
    source: input.source,
    message: input.message,
    relatedReferenceIds: input.relatedReferenceIds ?? [],
    metadata: input.metadata ?? {},
  };
}

/*
===============================================================================
Command Factory
===============================================================================
*/

/**
 * Creates a valid ExportDocumentCommand.
 *
 * A factory prevents every calling application from manually constructing
 * commands differently.
 */
export function createExportDocumentCommand(input: {
  ownerId: string;
  workspaceId: string;
  documentId: string;
  requestedOutputType: string;
  requestedBy: string;
  outputDirectory?: string;
}): ExportDocumentCommand {
  return {
    commandId: createTemporaryId("CMD"),
    commandType: "DOCUMENT.EXPORT",
    capability: "Document.Export",
    requestedOutputType: input.requestedOutputType,

    providerResolutionMode: "DYNAMIC",

    allowFallbackProviders: true,
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    documentId: input.documentId,

    requestedBy: input.requestedBy,
    submittedAt: new Date().toISOString(),

    outputDirectory:
      input.outputDirectory ?? path.resolve("output", "docforge"),
  };
}

/*
===============================================================================
Command Execution
===============================================================================
*/

/**
 * Executes an ExportDocumentCommand.
 *
 * Current implementation:
 *
 *     Command Service
 *         ↓ direct local call
 *     Text Export Provider
 *
 * Future implementation:
 *
 *     Application
 *         ↓
 *     SeloBond
 *         ↓
 *     Capability Discovery
 *         ↓
 *     Provider Acceptance
 *         ↓
 *     Event Execution
 *         ↓
 *     Result
 */
export async function executeExportDocumentCommand(
  command: ExportDocumentCommand,
): Promise<DocumentCommandExecution> {
  const event: DocumentExportEvent = {
    eventId: createTemporaryId("EVT"),
    eventType: "DOCUMENT.EXPORT",

    originatingCommandId: command.commandId,
    rootCommandId: command.commandId,

    executionState: "CREATED",
    createdAt: new Date().toISOString(),
    progressPercent: 0,

    diagnosticLogEntries: [],
  };

  /*
   * Record that SeloBond-style execution has begun.
   */
  event.diagnosticLogEntries.push(
    createLogEntry({
      severity: "INFORMATION",
      category: "EXECUTION",
      source: "DocumentCommandService",
      message: "Document export Event created.",
      relatedReferenceIds: [command.commandId, event.eventId],
    }),
  );

  try {
    event.executionState = "RUNNING";
    event.startedAt = new Date().toISOString();
    event.progressPercent = 25;

    event.diagnosticLogEntries.push(
      createLogEntry({
        severity: "INFORMATION",
        category: "PROVIDER",
        source: "DocumentCommandService",
        message: "Document export provider selected and execution started.",
        relatedReferenceIds: [event.eventId],
        metadata: {
          capability: command.capability,
        },
      }),
    );

   const provider =
  await resolveDocumentExportProvider(
    {
      capability: "Document.Export",

      requestedOutputType:
        command.requestedOutputType,

      preferredProviderId:
        command.preferredProviderId,

      requiredProviderId:
        command.requiredProviderId,

      allowFallbackProviders:
        command.allowFallbackProviders,
    },
    {
      ownerId: command.ownerId,
      documentId: command.documentId,
      outputDirectory: command.outputDirectory,
      snapshotId: event.eventId,
    },
  );

event.diagnosticLogEntries.push(
  createLogEntry({
    severity: "INFORMATION",
    category: "PROVIDER_SELECTION",
    source: "ProviderRegistry",
    message:
      `Selected provider: ${provider.providerId}`,
    metadata: {
      providerId:
        provider.providerId,

      providerInstanceId:
        provider.providerInstanceId,
    },
  }),
);

const providerResult:
  DocumentExportProviderResult =
    await provider.execute({
      ownerId: command.ownerId,
      documentId: command.documentId,
      outputDirectory:
        command.outputDirectory,
      snapshotId:
        event.eventId,
    });

    event.progressPercent = 75;

    event.diagnosticLogEntries.push(
      createLogEntry({
        severity: "INFORMATION",
        category: "OUTPUT",
        source: "TextExportProvider",
        message: "Immutable text file snapshot created.",
        relatedReferenceIds: [
          command.documentId,
          event.eventId,
        ],
        metadata: {
          fileName: providerResult.fileName,
          byteLength: providerResult.byteLength,
        },
      }),
    );

    const immutableReference: ImmutableFileReference = {
      referenceType: "IMMUTABLE_FILE_SNAPSHOT",
      referenceId: createTemporaryId("REF"),

      fileName: providerResult.fileName,
      filePath: providerResult.filePath,
      mimeType: providerResult.mimeType,
      byteLength: providerResult.byteLength,
      sha256: providerResult.sha256,

      sourceDocumentId: providerResult.documentId,
      sourceDocumentVersion: providerResult.documentVersion,
      createdAt: new Date().toISOString(),
    };

    const result: ExportDocumentResult = {
      resultId: createTemporaryId("RES"),
      resultType: "DOCUMENT.EXPORT",

      originatingCommandId: command.commandId,
      originatingEventId: event.eventId,

      businessOutcome: "SUCCESS",
      summary: `Document ${command.documentId} exported successfully.`,

      producedReferences: [immutableReference],

      createdAt: new Date().toISOString(),

      inlineData: {
        fileCount: 1,
        totalBytes: providerResult.byteLength,
      },
    };

    event.executionState = "SUCCESS";
    event.progressPercent = 100;
    event.completedAt = new Date().toISOString();

    event.diagnosticLogEntries.push(
      createLogEntry({
        severity: "INFORMATION",
        category: "RESULT",
        source: "DocumentCommandService",
        message: "Document export completed successfully.",
        relatedReferenceIds: [
          command.commandId,
          event.eventId,
          result.resultId,
          immutableReference.referenceId,
        ],
      }),
    );

    return {
      command,
      event,
      result,
    };
  } catch (error: unknown) {
    /*
     * TypeScript treats caught errors as unknown because JavaScript permits
     * throwing values other than Error objects.
     */
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    event.executionState = "FAILED";
    event.executionReason = errorMessage;
    event.completedAt = new Date().toISOString();

    event.diagnosticLogEntries.push(
      createLogEntry({
        severity: "ERROR",
        category: "EXECUTION",
        source: "DocumentCommandService",
        message: errorMessage,
        relatedReferenceIds: [command.commandId, event.eventId],
      }),
    );

    const failedResult: ExportDocumentResult = {
      resultId: createTemporaryId("RES"),
      resultType: "DOCUMENT.EXPORT",

      originatingCommandId: command.commandId,
      originatingEventId: event.eventId,

      businessOutcome: "FAILED",
      businessReason: errorMessage,
      summary: `Document ${command.documentId} could not be exported.`,

      producedReferences: [],

      createdAt: new Date().toISOString(),

      inlineData: {
        fileCount: 0,
        totalBytes: 0,
      },
    };

    /*
     * We return a failed Result rather than throwing again.
     * This matches the SEMA principle that every terminal Event produces a
     * Result, including failed Events.
     */
    return {
      command,
      event,
      result: failedResult,
    };
  }
}
