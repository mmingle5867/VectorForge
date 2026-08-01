import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function createTextDocument(input: {
  documentId: string;
  ownerId: string;
  workspaceId: string;
  title: string;
  content: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.document.create({
    data: {
      documentId: input.documentId,
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      title: input.title,
      content: input.content,
      format: "txt",
      metadata: input.metadata ?? {},
    },
  });
}

export async function getDocumentByDocumentId(ownerId: string, documentId: string) {
  return prisma.document.findUnique({
    where: {
      ownerId_documentId: {
        ownerId,
        documentId,
      },
    },
  });
}