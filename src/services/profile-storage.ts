import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { issueSemaIdentifier } from '@/services/sema-core-identity';
import { ensureOwnerAndWorkspace } from '@/services/sema-identity';

export const DEFAULT_STORAGE_ROOT_PATH = './vectorforge-storage';
export const DEFAULT_STORAGE_LOCATION_NAME = 'VectorForge Local Workspace';

export interface VectorForgeStoragePaths {
  base: string;
  processing: string;
  artwork: string;
  bundles: string;
}

type StorageLocationKindValue =
  | 'LOCAL_FILESYSTEM'
  | 'NETWORK_FILESYSTEM'
  | 'REMOVABLE_STORAGE'
  | 'CLOUD_PROVIDER'
  | 'OTHER';

function requireBasePath(value: string): string {
  const basePath = value.trim();
  if (!basePath) {
    throw new Error('Storage location base path is required');
  }
  return basePath;
}

function safeProfileDirectoryName(profileId: string): string {
  return profileId
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default-profile';
}

export function resolveProfileStorageBasePath(storageRootPath: string, profileId: string) {
  const root = path.isAbsolute(storageRootPath)
    ? path.resolve(storageRootPath)
    : path.resolve(process.cwd(), storageRootPath);
  return path.join(root, 'profiles', safeProfileDirectoryName(profileId));
}

function storageLocationName(basePath: string) {
  const pathId = createHash('sha256').update(path.resolve(basePath)).digest('hex').slice(0, 8);
  return `${DEFAULT_STORAGE_LOCATION_NAME} ${pathId}`;
}

export function getVectorForgeStoragePaths(basePath: string): VectorForgeStoragePaths {
  const base = path.resolve(basePath);
  return {
    base,
    processing: path.join(base, 'processing'),
    artwork: path.join(base, 'artwork'),
    bundles: path.join(base, 'bundles'),
  };
}

export async function ensureVectorForgeStorageDirectories(basePath: string) {
  const paths = getVectorForgeStoragePaths(basePath);
  await Promise.all([
    mkdir(paths.processing, { recursive: true }),
    mkdir(paths.artwork, { recursive: true }),
    mkdir(paths.bundles, { recursive: true }),
  ]);
  return paths;
}

export async function ensureDefaultSemaProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found for SEMA profile');
  }

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;

  const existing = await prisma.semaProfile.findFirst({
    where: { userId, isDefault: true, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;

  const profileId = (await issueSemaIdentifier('PRF', {
    purpose: 'default-sema-profile',
  })).id;

  return prisma.$transaction(async (tx) => {
    await tx.semaProfile.updateMany({
      where: { userId, isDefault: true, profileId: { not: profileId } },
      data: { isDefault: false },
    });

    return tx.semaProfile.create({
      data: {
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
  const locationIdentifier = await issueSemaIdentifier('LOC', {
    purpose: 'storage-location',
    name,
  });

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
        locationId: locationIdentifier.id,
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

export async function configureDefaultImportStorageForUser(input: {
  userId: string;
  storageRootPath?: string;
}) {
  const profile = await ensureDefaultSemaProfile(input.userId);
  const { workspace } = await ensureOwnerAndWorkspace(input.userId);
  const basePath = resolveProfileStorageBasePath(
    input.storageRootPath?.trim() || DEFAULT_STORAGE_ROOT_PATH,
    profile.profileId
  );
  const locationName = storageLocationName(basePath);
  const locationIdentifier = await issueSemaIdentifier('LOC', {
    purpose: 'default-import-storage-location',
  });

  const location = await prisma.$transaction(async (tx) => {
    await tx.storageLocation.updateMany({
      where: {
        profileId: profile.id,
        isDefaultImport: true,
        name: { not: locationName },
      },
      data: { isDefaultImport: false },
    });

    const location = await tx.storageLocation.upsert({
      where: {
        profileId_name: {
          profileId: profile.id,
          name: locationName,
        },
      },
      update: {
        workspaceId: workspace.id,
        basePath,
        isDefaultImport: true,
        isReadOnly: false,
        status: 'ACTIVE',
        metadata: {
          application: 'VectorForge',
          layoutVersion: 1,
          configuredRootPath: input.storageRootPath?.trim() || DEFAULT_STORAGE_ROOT_PATH,
        },
      },
      create: {
        locationId: locationIdentifier.id,
        profileId: profile.id,
        workspaceId: workspace.id,
        name: locationName,
        kind: 'LOCAL_FILESYSTEM',
        basePath,
        isDefaultImport: true,
        metadata: {
          application: 'VectorForge',
          layoutVersion: 1,
          configuredRootPath: input.storageRootPath?.trim() || DEFAULT_STORAGE_ROOT_PATH,
        },
      },
    });
    return location;
  });

  const paths = await ensureVectorForgeStorageDirectories(location.basePath);
  return { profile, workspace, location, paths };
}

export async function configureAdditionalStorageForUser(input: {
  userId: string;
  storageRootPath: string;
  makeDefaultImport?: boolean;
}) {
  const configuredRootPath = requireBasePath(input.storageRootPath);
  const profile = await ensureDefaultSemaProfile(input.userId);
  const { workspace } = await ensureOwnerAndWorkspace(input.userId);
  const basePath = resolveProfileStorageBasePath(configuredRootPath, profile.profileId);
  const locationName = storageLocationName(basePath);
  const locationIdentifier = await issueSemaIdentifier('LOC', {
    purpose: 'additional-storage-location',
  });

  const location = await prisma.$transaction(async (tx) => {
    if (input.makeDefaultImport) {
      await tx.storageLocation.updateMany({
        where: { profileId: profile.id, isDefaultImport: true, name: { not: locationName } },
        data: { isDefaultImport: false },
      });
    }
    const location = await tx.storageLocation.upsert({
      where: { profileId_name: { profileId: profile.id, name: locationName } },
      update: {
        workspaceId: workspace.id,
        basePath,
        isDefaultImport: input.makeDefaultImport ?? undefined,
        isReadOnly: false,
        status: 'ACTIVE',
        metadata: { application: 'VectorForge', layoutVersion: 1, configuredRootPath },
      },
      create: {
        locationId: locationIdentifier.id,
        profileId: profile.id,
        workspaceId: workspace.id,
        name: locationName,
        kind: 'LOCAL_FILESYSTEM',
        basePath,
        isDefaultImport: input.makeDefaultImport ?? false,
        metadata: { application: 'VectorForge', layoutVersion: 1, configuredRootPath },
      },
    });
    if (input.makeDefaultImport) {
      const currentSettings = await tx.userSettings.findUnique({ where: { userId: input.userId } });
      const currentExtended = currentSettings?.defaultSubstitutions && typeof currentSettings.defaultSubstitutions === 'object' && !Array.isArray(currentSettings.defaultSubstitutions)
        ? currentSettings.defaultSubstitutions as Prisma.JsonObject
        : {};
      await tx.userSettings.upsert({
        where: { userId: input.userId },
        update: { defaultSubstitutions: { ...currentExtended, storageRootPath: configuredRootPath } },
        create: { userId: input.userId, defaultSubstitutions: { storageRootPath: configuredRootPath } },
      });
    }
    return location;
  });

  const paths = await ensureVectorForgeStorageDirectories(location.basePath);
  return { profile, workspace, location, paths };
}
