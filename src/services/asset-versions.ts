import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  normalizeByteLength,
  normalizeRelativeAssetPath,
  normalizeSha256,
} from '@/lib/asset-location-rules';
import prisma from '@/lib/prisma';

type AssetVersionStatusValue = 'DRAFT' | 'PREVIEW' | 'APPROVED' | 'RETIRED' | 'VOIDED';

function makeAssetVersionId(): string {
  return `ASSET-VERSION-${randomUUID().toUpperCase()}`;
}

export async function createAssetVersion(input: {
  assetId: string;
  createdByProfileId: string;
  storageLocationId: string;
  relativePath: string;
  sha256: string;
  byteLength: number | bigint;
  mimeType?: string | null;
  status?: AssetVersionStatusValue;
  metadata?: Prisma.InputJsonValue;
  verifiedAt?: Date | null;
}) {
  const relativePath = normalizeRelativeAssetPath(input.relativePath);
  const sha256 = normalizeSha256(input.sha256);
  const byteLength = normalizeByteLength(input.byteLength);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "assets"
      WHERE id = ${input.assetId}
      FOR UPDATE
    `;

    const asset = await tx.asset.findUnique({
      where: { id: input.assetId },
      include: { owner: true },
    });
    if (!asset) {
      throw new Error('Asset not found for version creation');
    }

    const storageLocation = await tx.storageLocation.findUnique({
      where: { id: input.storageLocationId },
    });
    if (!storageLocation || storageLocation.status !== 'ACTIVE') {
      throw new Error('Active Storage Location not found');
    }
    if (storageLocation.isReadOnly) {
      throw new Error('Cannot create an Asset version in a read-only Storage Location');
    }
    if (storageLocation.workspaceId && storageLocation.workspaceId !== asset.workspaceId) {
      throw new Error('Asset and Storage Location belong to different workspaces');
    }

    const profile = await tx.semaProfile.findUnique({
      where: { id: input.createdByProfileId },
    });
    if (
      !profile ||
      profile.status !== 'ACTIVE' ||
      profile.id !== storageLocation.profileId ||
      profile.userId !== asset.owner.userId
    ) {
      throw new Error('Creating profile is not authorized for this Asset and Storage Location');
    }

    const latest = await tx.assetVersion.aggregate({
      where: { assetId: asset.id },
      _max: { versionNumber: true },
    });
    const versionNumber = (latest._max.versionNumber ?? 0) + 1;

    return tx.assetVersion.create({
      data: {
        assetVersionId: makeAssetVersionId(),
        assetId: asset.id,
        createdByProfileId: input.createdByProfileId,
        versionNumber,
        status: input.status ?? 'DRAFT',
        sha256,
        byteLength,
        mimeType: input.mimeType ?? asset.mimeType,
        metadata: input.metadata ?? {},
        locations: {
          create: {
            storageLocationId: storageLocation.id,
            relativePath,
            isPrimary: true,
            verifiedAt: input.verifiedAt ?? null,
          },
        },
      },
      include: { locations: true },
    });
  });
}

export async function addAssetVersionLocation(input: {
  assetVersionId: string;
  requestingProfileId: string;
  storageLocationId: string;
  relativePath: string;
  isPrimary?: boolean;
  verifiedAt?: Date | null;
}) {
  const relativePath = normalizeRelativeAssetPath(input.relativePath);

  return prisma.$transaction(async (tx) => {
    const version = await tx.assetVersion.findUnique({
      where: { id: input.assetVersionId },
      include: { asset: { include: { owner: true } } },
    });
    const location = await tx.storageLocation.findUnique({
      where: { id: input.storageLocationId },
      include: { profile: true },
    });
    if (!version || !location || location.status !== 'ACTIVE') {
      throw new Error('Asset version or active Storage Location not found');
    }
    if (
      location.profileId !== input.requestingProfileId ||
      location.profile.status !== 'ACTIVE' ||
      location.profile.userId !== version.asset.owner.userId
    ) {
      throw new Error('Requesting profile is not authorized for this Storage Location');
    }
    if (location.isReadOnly) {
      throw new Error('Cannot add an Asset location to read-only storage');
    }
    if (location.workspaceId && location.workspaceId !== version.asset.workspaceId) {
      throw new Error('Asset version and Storage Location belong to different workspaces');
    }

    if (input.isPrimary) {
      await tx.assetLocation.updateMany({
        where: { assetVersionId: version.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return tx.assetLocation.create({
      data: {
        assetVersionId: version.id,
        storageLocationId: location.id,
        relativePath,
        isPrimary: input.isPrimary ?? false,
        verifiedAt: input.verifiedAt ?? null,
      },
    });
  });
}
