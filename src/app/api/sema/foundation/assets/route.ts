import { NextRequest, NextResponse } from 'next/server';

import prisma from '@/lib/prisma';
import { FOUNDATION_ASSET_CATALOG_CAPABILITY } from '@/capabilities/foundation-asset-catalog/registry';

export const runtime = 'nodejs';

/**
 * Provider-side SEMA Foundation catalog. This is intentionally a filtered
 * reference view: it never returns storage paths, original/working files, or
 * private VectorForge row keys.
 */
export async function GET(request: NextRequest) {
  if (request.headers.get('x-sema-capability-key') !== FOUNDATION_ASSET_CATALOG_CAPABILITY) {
    return NextResponse.json({ error: 'Capability contract header is required.' }, { status: 403 });
  }

  const assets = await prisma.asset.findMany({
    where: {
      status: 'ACTIVE',
      role: { notIn: ['original-file', 'source-file'] },
      versions: { some: { status: 'APPROVED' } },
    },
    include: {
      owner: { select: { ownerId: true } },
      workspace: { select: { workspaceId: true } },
      item: { select: { itemId: true } },
      artwork: { select: { artworkNumber: true, title: true } },
      versions: {
        where: { status: 'APPROVED' },
        orderBy: [{ versionNumber: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { assetVersionId: true, versionNumber: true, mimeType: true, createdAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({
    capabilityKey: FOUNDATION_ASSET_CATALOG_CAPABILITY,
    contractVersion: '1.0.0',
    assets: assets.flatMap((asset) => {
      const version = asset.versions[0];
      if (!version) return [];
      return [{
        ownerId: asset.owner.ownerId,
        workspaceId: asset.workspace.workspaceId,
        itemId: asset.item.itemId,
        artworkId: asset.artwork.artworkNumber,
        assetId: asset.assetId,
        assetVersionId: version.assetVersionId,
        title: asset.artwork.title,
        role: asset.role,
        mimeType: version.mimeType ?? asset.mimeType,
        versionNumber: version.versionNumber,
        versionPolicy: 'APPROVAL_REQUIRED',
      }];
    }),
  });
}
