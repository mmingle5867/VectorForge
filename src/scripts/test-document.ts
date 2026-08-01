import { createTextDocument } from "@/services/document-service";

async function main() {
  const result = await createTextDocument({
    documentId: "DOC-000001",
    ownerId: "cmqwlis97000xw65se30ubzeu",
    workspaceId: "cmqwlis9c000zw65sqkpi3q80",
    title: "First SEMA Document",
    content: "Hello from DocForge.",
    metadata: {
      source: "DocForge",
      version: 1,
    },
  });

  console.log(result);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });