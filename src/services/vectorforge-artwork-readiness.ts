import prisma from '@/lib/prisma';

/**
 * VectorForge's application boundary for artwork that another application may
 * use. "Ready" is deliberately derived from approved, saved vector output;
 * it is not a dashboard-only flag and it does not move any files.
 */
export const READY_VECTOR_ARTWORK_CAPABILITY = 'vectorforge.artwork.ready-for-use';

export const approvedVectorAssetWhere = {
  role: 'approved-svg',
  status: 'ACTIVE',
  metadata: { path: ['reviewStatus'], equals: 'APPROVED' },
} as const;

export function readyArtworkWhere(userId: string) {
  return {
    userId,
    status: 'ACTIVE' as const,
    batchItems: { none: {} },
    assets: { some: approvedVectorAssetWhere },
  };
}

export function workspaceArtworkWhere(userId: string) {
  return {
    userId,
    status: 'ACTIVE' as const,
    batchItems: { none: {} },
    NOT: { assets: { some: approvedVectorAssetWhere } },
  };
}

/**
 * Consumer-facing read model. ListingForge and future applications should use
 * this service (or GET /api/artwork/ready), never infer readiness from a file
 * name or VectorForge dashboard state.
 */
export async function listReadyVectorArtworkForConsumer(userId: string) {
  return prisma.artwork.findMany({
    where: readyArtworkWhere(userId),
    orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
    select: {
      id: true,
      artworkNumber: true,
      title: true,
      ownerId: true,
      workspaceId: true,
      itemId: true,
      updatedAt: true,
      assets: {
        where: { role: { in: ['approved-svg', 'approved-png', 'approved-jpg'] }, status: 'ACTIVE' },
        select: { assetId: true, role: true, filePath: true, mimeType: true, metadata: true },
      },
    },
  });
}
