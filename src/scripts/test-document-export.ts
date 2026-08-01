import path from "node:path";

import { exportTextDocument } from "@/services/document-export-service";

async function main() {
  const result = await exportTextDocument({
    ownerId: "cmqwlis97000xw65se30ubzeu",
    documentId: "DOC-000001",
    outputDirectory: path.resolve("output", "docforge"),
  });

  console.log("Document exported:");
  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});