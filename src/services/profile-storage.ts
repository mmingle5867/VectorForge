import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';

type StorageLocationKindValue =
  | 'LOCAL_FILESYSTEM'
  | 'NETWORK_FILESYSTEM'
  | 'REMOVABLE_STORAGE'
  | 'CLOUD_PROVIDER'
  | 'OTHER';

function makeDefaultProfileId(userId: string): string {
  return `PROFILE-LOCAL-${userId}`;
}

function makeStorageLocationId(): string {
  return `LOCATION-${randomUUID().toUpperCase()}`;
}

function requireBasePath(value: string): string {
  const basePath = value.trim();
  if (!basePath) {
    throw new Error('Storage location base path is required');
  }
  return basePath;
}

export async function ensureDefaultSemaProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found for SEMA profile');
  }

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;

  const profileId = makeDefaultProfileId(userId);

  return prisma.$transaction(async (tx) => {
    await tx.semaProfile.updateMany({
      where: { userId, isDefault: true, profileId: { not: profileId } },
      data: { isDefault: false },
    });

    return tx.semaProfile.upsert({
      where: { profileId },
      update: {
        displayName,
        isDefault: true,
        status: 'ACTIVE',
      },
      create: {
        profileId,
        userId,
        displayName,
        isDefault: true,
      },
    });
  });
}

export async function registerStorageLocation(input: {
  profileId: string;
  workspaceId?: string | null;
  name: string;
  kind: StorageLocationKindValue;
  basePath: string;
  isDefaultImport?: boolean;
  isReadOnly?: boolean;
  metadata?: Prisma.InputJsonValue;
}) {
  const name = input.name.trim();
  if (!name) {
    throw new Error('Storage location name is required');
  }

  const profile = await prisma.semaProfile.findUnique({
    where: { id: input.profileId },
  });
  if (!profile || profile.status !== 'ACTIVE') {
    throw new Error('Active SEMA profile not found');
  }

  if (input.workspaceId) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      include: { owner: true },
    });
    if (!workspace || workspace.owner.userId !== profile.userId) {
      throw new Error('Workspace is not available to this SEMA profile');
    }
  }

  return prisma.$transaction(async (tx) => {
    if (input.isDefaultImport) {
      await tx.storageLocation.updateMany({
        where: { profileId: profile.id, isDefaultImport: true },
        data: { isDefaultImport: false },
      });
    }

    return tx.storageLocation.create({
      data: {
        locationId: makeStorageLocationId(),
        profileId: profile.id,
        workspaceId: input.workspaceId ?? null,
        name,
        kind: input.kind,
        basePath: requireBasePath(input.basePath),
        isDefaultImport: input.isDefaultImport ?? false,
        isReadOnly: input.isReadOnly ?? false,
        metadata: input.metadata ?? {},
      },
    });
  });
}

export async function setDefaultImportStorageLocation(
  profileId: string,
  storageLocationId: string
) {
  return prisma.$transaction(async (tx) => {
    const location = await tx.storageLocation.findFirst({
      where: {
        id: storageLocationId,
        profileId,
        status: 'ACTIVE',
        isReadOnly: false,
      },
    });
    if (!location) {
      throw new Error('Writable storage location not found for this profile');
    }

    await tx.storageLocation.updateMany({
      where: { profileId, isDefaultImport: true },
      data: { isDefaultImport: false },
    });

    return tx.storageLocation.update({
      where: { id: location.id },
      data: { isDefaultImport: true },
    });
  });
}

export async function getDefaultImportStorageLocation(profileId: string) {
  return prisma.storageLocation.findFirst({
    where: {
      profileId,
      isDefaultImport: true,
      isReadOnly: false,
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'asc' },
  });
}
