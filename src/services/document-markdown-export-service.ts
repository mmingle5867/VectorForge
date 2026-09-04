/*
===============================================================================
Markdown Export Provider
-------------------------------------------------------------------------------

Purpose:
    Export a Document as an immutable Markdown snapshot.

Why a separate provider?

    TXT and Markdown are different capabilities.

    TXT:
        Plain text only.

    Markdown:
        Lightweight formatting language.

The Command Service should not care which provider performs the work.

Future providers may include:

    PDF Provider
    DOCX Provider
    HTML Provider
    Email Provider

This is the first proof that provider swapping works.

===============================================================================
*/

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDocumentByDocumentId } from "@/services/document-service";

export interface MarkdownExportProviderResult {
  documentId: string;
  documentVersion: number;
  fileName: string;
  filePath: string;
  mimeType: "text/markdown";
  byteLength: number;
  sha256: string;
}

function safeFileName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
}

function createSha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function exportMarkdownDocument(input: {
  ownerId: string;
  documentId: string;
  outputDirectory: string;
  snapshotId: string;
}): Promise<MarkdownExportProviderResult> {

  const document = await getDocumentByDocumentId(
    input.ownerId,
    input.documentId,
  );

  if (!document) {
    throw new Error(`Document not found: ${input.documentId}`);
  }

  const titlePart =
    safeFileName(document.title) || document.documentId;

  const fileName =
    `${titlePart}-v${document.version}-${input.snapshotId}.md`;

  const filePath =
    path.join(input.outputDirectory, fileName);

  await mkdir(input.outputDirectory, {
    recursive: true,
  });

  /*
   * For now we simply write the document content exactly as stored.
   *
   * Later:
   *
   * Document Object
   *      ↓
   * Markdown Renderer
   *      ↓
   * Markdown Snapshot
   *
   * For V1 this provider simply proves the capability architecture.
   */
  await writeFile(
    filePath,
    document.content,
    "utf8",
  );

  const fileContent = await readFile(filePath);
  const fileStats = await stat(filePath);

  return {
    documentId: document.documentId,
    documentVersion: document.version,
    fileName,
    filePath,
    mimeType: "text/markdown",
    byteLength: fileStats.size,
    sha256: createSha256(fileContent),
  };
}
