import path from 'node:path';

import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { getManagedArtworkDirectory } from '@/lib/artwork-storage-paths';
import { normalizeStatusColors } from '@/lib/status-colors';
import prisma from '@/lib/prisma';
import { configureDefaultImportStorageForUser } from '@/services/profile-storage';

function getStorageRootSetting(settings: { defaultSubstitutions: unknown } | null) {
  const values = settings?.defaultSubstitutions;
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    const value = (values as Record<string, unknown>).storageRootPath;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Artwork-first dashboard listing. Batch records are not part of this model. */
export async function GET() {
  try {
    const user = await requireAuth();
    const storage = await configureDefaultImportStorageForUser({
      userId: user.id,
      storageRootPath: getStorageRootSetting(user.settings),
    });
    const artworks = await prisma.artwork.findMany({
      where: { userId: user.id, status: 'ACTIVE', batchItems: { none: {} } },
      orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      select: {
        id: true, artworkNumber: true, title: true, createdAt: true, updatedAt: true,
        item: {
          select: {
            id: true, itemId: true,
            categoryMemberships: { select: { category: { select: { id: true, categoryId: true, name: true } } } },
          },
        },
        assets: {
          where: { role: { in: ['source-file', 'original-file', 'approved-svg'] } },
          select: {
            assetId: true, role: true, filePath: true, mimeType: true, metadata: true,
            versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { byteLength: true, metadata: true } },
          },
        },
      },
    });
    const locations = await prisma.storageLocation.findMany({
      where: { profileId: storage.profile.id, status: 'ACTIVE' },
      orderBy: [{ isDefaultImport: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, basePath: true, isDefaultImport: true, isReadOnly: true, metadata: true },
    });

    return NextResponse.json({
      success: true,
      profile: { id: storage.profile.id, profileId: storage.profile.profileId, displayName: storage.profile.displayName },
      storage: {
        ...storage.paths,
        locations: locations.map((location) => {
          const metadata = location.metadata && typeof location.metadata === 'object' && !Array.isArray(location.metadata)
            ? location.metadata as Record<string, unknown> : {};
          return { ...location, rootPath: typeof metadata.configuredRootPath === 'string' ? metadata.configuredRootPath : location.basePath };
        }),
      },
      statusColors: normalizeStatusColors(
        user.settings?.defaultSubstitutions && typeof user.settings.defaultSubstitutions === 'object'
          ? (user.settings.defaultSubstitutions as Record<string, unknown>).statusColors : undefined
      ),
      items: [
        ...artworks.map((artwork) => {
        const working = artwork.assets.find((asset) => asset.role === 'source-file');
        const original = artwork.assets.find((asset) => asset.role === 'original-file');
        const approvedVector = artwork.assets.find((asset) => asset.role === 'approved-svg');
        const approvedMetadata = approvedVector?.metadata && typeof approvedVector.metadata === 'object' && !Array.isArray(approvedVector.metadata)
          ? approvedVector.metadata as Record<string, unknown> : {};
        const filePath = working?.filePath ?? original?.filePath ?? null;
        const filename = filePath ? path.basename(filePath) : artwork.title;
        const latestVersion = working?.versions[0] ?? original?.versions[0];
        const metadata = latestVersion?.metadata && typeof latestVersion.metadata === 'object' && !Array.isArray(latestVersion.metadata)
          ? latestVersion.metadata as Record<string, unknown> : {};
        return {
          id: artwork.id,
          batchId: null,
          itemId: artwork.item?.id ?? null,
          artworkId: artwork.artworkNumber,
          workingAssetId: working?.assetId ?? null,
          originalFilename: filename,
          baseName: path.basename(filename, path.extname(filename)),
          extension: path.extname(filename).slice(1).toUpperCase(),
          mimeType: working?.mimeType ?? original?.mimeType ?? null,
          size: latestVersion ? Number(latestVersion.byteLength) : null,
          width: typeof metadata.width === 'number' ? metadata.width : null,
          height: typeof metadata.height === 'number' ? metadata.height : null,
          status: approvedMetadata.reviewStatus === 'NEEDS_VECTOR_EDIT' ? 'NEEDS_VECTOR_EDIT' : approvedVector ? 'APPROVED' : 'UNPROCESSED',
          progress: 0,
          currentStep: null,
          error: null,
          workingPath: working?.filePath ?? null,
          workingDirectory: filePath ? getManagedArtworkDirectory(filePath) : null,
          previewUrl: `/api/artwork/${artwork.id}/preview?v=${artwork.updatedAt.getTime()}`,
          originalPreviewUrl: `/api/artwork/${artwork.id}/preview?variant=original`,
          categories: artwork.item?.categoryMemberships.map(({ category }) => category) ?? [],
          createdAt: artwork.createdAt,
          updatedAt: artwork.updatedAt,
          artworkFirst: true,
        };
        }),
      ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load files' }, { status: 500 });
  }
}
