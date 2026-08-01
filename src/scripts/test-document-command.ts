/*
===============================================================================
Document Command Execution Test
-------------------------------------------------------------------------------
This script acts like a temporary client application.

It:
    1. Creates a Command.
    2. Executes the Command.
    3. Receives the Event and Result.
    4. Prints the entire execution chain.

===============================================================================
*/

import {
  createExportDocumentCommand,
  executeExportDocumentCommand,
} from "@/services/document-command-service";

async function main(): Promise<void> {
  const command = createExportDocumentCommand({
    ownerId: "cmqwlis97000xw65se30ubzeu",
    workspaceId: "cmqwlis9c000zw65sqkpi3q80",
    documentId: "DOC-000001",

    requestedOutputType: "text/markdown",

    requestedBy: "local-developer",
  });

  const execution =
    await executeExportDocumentCommand(command);

  console.dir(execution, {
    depth: null,
    colors: true,
  });
}

main().catch((error: unknown) => {
  console.error("Unexpected test-script failure:", error);
  process.exitCode = 1;
});