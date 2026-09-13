import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createAssetVersion } from '@/services/asset-versions';

/** Records a new review version only when an external editor changed a saved output. */
export async function POST(_req: Request, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    const profile = await prisma.semaProfile.findFirst({ where: { userId: user.id, status: 'ACTIVE' } });
    const artwork = await prisma.artwork.findFirst({
      where: { id: artworkId, userId: user.id, status: 'ACTIVE', batchItems: { none: {} } },
      include: {
        assets: {
          where: { role: { in: ['approved-png', 'approved-jpg'] }, status: 'ACTIVE' },
          include: {
            versions: {
              orderBy: { versionNumber: 'desc' }, take: 1,
              include: { locations: { where: { isPrimary: true }, take: 1, include: { storageLocation: { select: { basePath: true } } } } },
            },
          },
        },
      },
    });
    if (!profile || !artwork) return NextResponse.json({ success: false, error: 'Artwork output was not found' }, { status: 404 });
    const changed: string[] = [];
    for (const asset of artwork.assets) {
      if (!asset.filePath || !asset.versions[0]?.locations[0]) continue;
      const file = await readFile(asset.filePath);
      const sha256 = createHash('sha256').update(file).digest('hex');
      if (asset.versions[0].sha256 === sha256) continue;
      const location = asset.versions[0].locations[0];
      await createAssetVersion({ assetId: asset.id, createdByProfileId: profile.id, storageLocationId: location.storageLocationId, relativePath: path.relative(location.storageLocation.basePath, asset.filePath), sha256, byteLength: file.byteLength, mimeType: asset.mimeType, status: 'DRAFT', metadata: { editedExternally: true, requiresReview: true } });
      changed.push(asset.role);
    }
    return NextResponse.json({ success: true, changed });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to refresh saved outputs' }, { status: 400 }); }
}
