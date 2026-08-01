/*
===============================================================================
Document Text Export Provider
-------------------------------------------------------------------------------
Purpose:
    Exports a stored Document as an immutable TXT file snapshot.

Why "immutable":
    A SEMA Result must always refer to exactly what was produced at execution
    time. If a later export overwrote the same filename, an older Result would
    silently point to different content.

Solution:
    The caller supplies a unique snapshot ID. It becomes part of the filename,
    ensuring each export has its own permanent output.

Architecture role:
    This file behaves like a capability provider.

        Capability: Document.ExportText
        Input:      Document reference and output settings
        Output:     Immutable exported-file reference

===============================================================================
*/

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDocumentByDocumentId } from "@/services/document-service";

/**
 * Describes the information returned by the text export provider.
 *
 * `Promise<TextExportProviderResult>` means the operation happens
 * asynchronously and eventually returns this object.
 */
export interface TextExportProviderResult {
  documentId: string;
  documentVersion: number;
  fileName: string;
  filePath: string;
  mimeType: "text/plain";
  byteLength: number;
  sha256: string;
}

/**
 * Converts a title into a filename that is safe on Windows and other systems.
 */
function safeFileName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
}

/**
 * Produces a SHA-256 content hash.
 *
 * The hash lets us later prove that the file still contains the exact bytes
 * produced by this execution.
 */
function createSha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Exports one document as a uniquely named TXT snapshot.
 */
export async function exportTextDocument(input: {
  ownerId: string;
  documentId: string;
  outputDirectory: string;

  /*
   * Unique execution/snapshot identifier supplied by the command service.
   * Example: event ID or result ID.
   */
  snapshotId: string;
}): Promise<TextExportProviderResult> {
  const document = await getDocumentByDocumentId(
    input.ownerId,
    input.documentId,
  );

  if (!document) {
    throw new Error(`Document not found: ${input.documentId}`);
  }

  const titlePart = safeFileName(document.title) || document.documentId;

  /*
   * Including the document version and snapshot ID prevents later exports
   * from overwriting this one.
   */
  const fileName =
    `${titlePart}-v${document.version}-${input.snapshotId}.txt`;

  const filePath = path.join(input.outputDirectory, fileName);

  await mkdir(input.outputDirectory, { recursive: true });
  await writeFile(filePath, document.content, "utf8");

  /*
   * Read the finished file back so the hash represents what actually reached
   * disk, not merely what we intended to write.
   */
  const fileContent = await readFile(filePath);
  const fileStats = await stat(filePath);

  return {
    documentId: document.documentId,
    documentVersion: document.version,
    fileName,
    filePath,
    mimeType: "text/plain",
    byteLength: fileStats.size,
    sha256: createSha256(fileContent),
  };
}