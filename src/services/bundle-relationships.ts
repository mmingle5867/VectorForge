import fs from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { BundleDetail, BundleSummary } from '@/services/bundle-discovery';
import type { BundlePlan, BundlePlanMember } from '@/services/bundle-planner';
import type { BundleRelationship } from '@/lib/package-manifest-schema';
import { issueNumber } from '@/services/numbering-service';

const RELATIONSHIP_TYPE = 'asset_bundle';

type RelationshipWithMembers = Prisma.RelationshipGetPayload<{
  include: {
    owner: true;
    workspace: true;
    item: true;
    artwork: true;
    members: {
      include: {
        asset: {
          include: {
            owner: true;
            workspace: true;
            item: true;
            artwork: true;
          };
        };
      };
      orderBy: { sortOrder: 'asc' };
    };
  };
}>;

type CreateAssetBundleInput = {
  userId: string;
  bundleName: string;
  relationshipId?: string;
  memberAssetIds: string[];
  metadata?: Prisma.InputJsonObject;
};

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function bundleFolderFor(value: string, index: number) {
  const base = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 80);

  return base || `Member${index + 1}`;
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function formatFromPath(filePath: string | null | undefined) {
  if (!filePath) return 'unknown';
  return path.extname(filePath).replace('.', '').toLowerCase() || 'unknown';
}

function mimeTypeFromFormat(format: string) {
  if (format === 'svg') return 'image/svg+xml';
  if (format === 'png') return 'image/png';
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function toRelationshipManifest(relationship: RelationshipWithMembers): BundleRelationship {
  return {
    RelationshipID: relationship.relationshipId,
    RelationshipType: relationship.relationshipType,
    OwnerID: relationship.owner.ownerId,
    WorkspaceID: relationship.workspace.workspaceId,
    ItemID: relationship.item.itemId,
    ArtworkID: relationship.artwork.artworkNumber,
    BundleName: relationship.bundleName,
    MemberAssetIDs: relationship.members.map((member) => ({
      AssetID: member.asset.assetId,
      sortOrder: member.sortOrder,
      role: member.asset.role,
      filePath: member.asset.filePath,
      ItemID: member.asset.item.itemId,
      ArtworkID: member.asset.artwork.artworkNumber,
    })),
    CreatedAt: relationship.createdAt.toISOString(),
    UpdatedAt: relationship.updatedAt.toISOString(),
  };
}

function toBundleSummary(relationship: RelationshipWithMembers): BundleSummary {
  return {
    bundleId: relationship.relationshipId,
    title: relationship.bundleName,
    createdAt: relationship.createdAt.toISOString(),
    updatedAt: relationship.updatedAt.toISOString(),
    memberCount: relationship.members.length,
    bundleFolderName: relationship.relationshipId,
    bundleFolderPath: '',
    manifestPath: '',
    zipPath: null,
    zipFolderPath: null,
    manifestStatus: 'present',
    zipStatus: 'missing',
    packageStatus: relationship.status.toLowerCase(),
    thumbnailPath:
      relationship.members.find((member) => member.asset.role === 'preview')?.asset.filePath ||
      relationship.members.find((member) => Boolean(member.asset.filePath))?.asset.filePath ||
      null,
  };
}

function toBundleDetail(relationship: RelationshipWithMembers): BundleDetail {
  return {
    ...toBundleSummary(relationship),
    manifest: {
      schemaVersion: '2.0',
      sourceApp: '',
      appVersion: '',
      createdAt: relationship.createdAt.toISOString(),
      updatedAt: relationship.updatedAt.toISOString(),
      package: {
        packageId: relationship.relationshipId,
        packageType: 'bundle-package',
        packageStatus: relationship.status.toLowerCase(),
      },
      owner: {
        companyId: '',
        brandId: '',
        createdByUserId: '',
        ownerId: relationship.owner.ownerId,
        workspaceId: relationship.workspace.workspaceId,
      },
      externalRefs: {
        sourceJobId: '',
        listingToolProductId: '',
      },
      artwork: {
        artworkId: relationship.artwork.artworkNumber,
        title: relationship.bundleName,
        slug: slugify(relationship.bundleName),
        sourceFileName: '',
        sourceType: 'relationship',
        inputFormat: 'asset_bundle',
      },
      assetProfiles: [],
      productProfiles: [],
      productVariants: [],
      files: {
        source: [],
        artwork: [],
        downloads: [],
        listingImages: [],
        compositeImages: [],
        metadata: [],
        package: [],
      },
      listing: {
        title: relationship.bundleName,
        shortTitle: '',
        description: '',
        shortDescription: '',
        bulletPoints: [],
        tags: [],
        keywords: [],
        category: '',
        subcategory: '',
        style: [],
        occasion: [],
        holiday: [],
        audience: [],
        suggestedPrice: null,
        currency: 'USD',
        notes: '',
      },
      bundle: {
        bundleId: relationship.relationshipId,
        title: relationship.bundleName,
        slug: slugify(relationship.bundleName),
        sku: relationship.relationshipId,
        memberCount: relationship.members.length,
        missingFilePolicy: 'fail',
        zipPath: '',
      },
      relationship: toRelationshipManifest(relationship),
      members: relationship.members.map((member) => ({
        sortOrder: member.sortOrder,
        packageId: relationship.relationshipId,
        artworkId: member.asset.artwork.artworkNumber,
        profileId: member.asset.role,
        productTitle: member.asset.artwork.title,
        assetIds: [member.asset.assetId],
        sourceManifestPath: '',
        sourcePackagePath: '',
        bundleFolder: bundleFolderFor(member.asset.artwork.title, member.sortOrder - 1),
        includedFiles: member.asset.filePath
          ? [
              {
                role: member.asset.role,
                sourcePath: member.asset.filePath,
                bundlePath: normalizeRelativePath(
                  path.join(
                    'members',
                    bundleFolderFor(member.asset.artwork.title, member.sortOrder - 1),
                    path.basename(member.asset.filePath)
                  )
                ),
                format: formatFromPath(member.asset.filePath),
                assetId: member.asset.assetId,
                ownerId: member.asset.owner.ownerId,
                workspaceId: member.asset.workspace.workspaceId,
                itemId: member.asset.item.itemId,
                artworkId: member.asset.artwork.artworkNumber,
              },
            ]
          : [],
      })),
      rights: {
        ownership: '',
        commercialUseAllowed: null,
        resaleAllowed: null,
        licenseType: '',
        sourceNotes: '',
      },
      readiness: {
        artworkApproved: true,
        filesComplete: relationship.members.every((member) => Boolean(member.asset.filePath)),
        listingCopyComplete: true,
        imagesComplete: false,
        downloadsComplete: false,
        readyForListingTool: false,
      },
      aiMetadata: {
        status: 'not_generated',
        generatedAt: null,
        model: null,
        source: 'manual',
        baseTitle: '',
        shortTitle: '',
        slug: '',
        summary: '',
        subjects: [],
        themes: [],
        styles: [],
        occasions: [],
        audiences: [],
        keywords: [],
        suggestedCategories: [],
        notes: '',
      },
      processingHistory: [],
      extensions: {
        listingTool: {},
        analytics: {},
        accounting: {},
        marketplaceSync: {},
      },
      generation: {
        status: 'relationship_only',
        workflowStatus: 'COMPLETED',
        generatedBy: '',
        notes: ['Internal bundle stores AssetID references only.'],
      },
    },
    members: relationship.members.map((member) => ({
      sortOrder: member.sortOrder,
      packageId: relationship.relationshipId,
      artworkId: member.asset.artwork.artworkNumber,
      profileId: member.asset.role,
      productTitle: member.asset.artwork.title,
      assetIds: [member.asset.assetId],
      sourceManifestPath: '',
      sourcePackagePath: '',
      bundleFolder: bundleFolderFor(member.asset.artwork.title, member.sortOrder - 1),
      includedFiles: member.asset.filePath
        ? [
            {
              role: member.asset.role,
              sourcePath: member.asset.filePath,
              bundlePath: member.asset.filePath,
              format: formatFromPath(member.asset.filePath),
              assetId: member.asset.assetId,
            },
          ]
        : [],
      thumbnailPath: member.asset.filePath,
    })),
    readmePath: null,
    licensePath: null,
  };
}

async function findRelationship(userId: string, relationshipId: string) {
  return prisma.relationship.findFirst({
    where: {
      relationshipId,
      relationshipType: RELATIONSHIP_TYPE,
      owner: { userId },
      status: 'ACTIVE',
    },
    include: {
      owner: true,
      workspace: true,
      item: true,
      artwork: true,
      members: {
        include: {
          asset: {
            include: {
              owner: true,
              workspace: true,
              item: true,
              artwork: true,
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
}

export async function createAssetBundleRelationship(input: CreateAssetBundleInput) {
  const bundleName = readString(input.bundleName);
  if (!bundleName) {
    throw new Error('bundleName is required');
  }

  const uniqueAssetIds = Array.from(new Set(input.memberAssetIds.map(readString).filter(Boolean)));
  if (uniqueAssetIds.length === 0) {
    throw new Error('memberAssetIds is required');
  }

  const assets = await prisma.asset.findMany({
    where: {
      assetId: { in: uniqueAssetIds },
      owner: { userId: input.userId },
      status: 'ACTIVE',
    },
    include: {
      owner: true,
      workspace: true,
      item: true,
      artwork: true,
    },
  });

  const assetByObjectId = new Map(assets.map((asset) => [asset.assetId, asset]));
  const missing = uniqueAssetIds.filter((assetId) => !assetByObjectId.has(assetId));
  if (missing.length > 0) {
    throw new Error(`Bundle assets not found: ${missing.join(', ')}`);
  }

  const orderedAssets = uniqueAssetIds.map((assetId) => assetByObjectId.get(assetId)!);
  const first = orderedAssets[0];
  const ownerMismatch = orderedAssets.some((asset) => asset.ownerId !== first.ownerId);
  const workspaceMismatch = orderedAssets.some((asset) => asset.workspaceId !== first.workspaceId);
  if (ownerMismatch || workspaceMismatch) {
    throw new Error('Bundle members must share the same OwnerID and WorkspaceID');
  }

  const relationshipId = input.relationshipId || (await issueNumber('bundle')).issuedNumber;

  const relationship = await prisma.$transaction(async (tx) => {
    const created = await tx.relationship.create({
      data: {
        relationshipId,
        relationshipType: RELATIONSHIP_TYPE,
        ownerId: first.ownerId,
        workspaceId: first.workspaceId,
        itemId: first.itemId,
        artworkId: first.artworkId,
        bundleName,
        metadata: {
          ...(input.metadata || {}),
          memberAssetIds: uniqueAssetIds,
        },
      },
    });

    await tx.relationshipMember.createMany({
      data: orderedAssets.map((asset, index) => ({
        relationshipId: created.id,
        assetId: asset.id,
        sortOrder: index + 1,
        metadata: {
          AssetID: asset.assetId,
          role: asset.role,
          filePath: asset.filePath,
          ItemID: asset.item.itemId,
          ArtworkID: asset.artwork.artworkNumber,
        },
      })),
    });

    return created;
  });

  return loadAssetBundleRelationship(input.userId, relationship.relationshipId);
}

export async function listAssetBundleRelationships(userId: string) {
  const relationships = await prisma.relationship.findMany({
    where: {
      relationshipType: RELATIONSHIP_TYPE,
      owner: { userId },
      status: 'ACTIVE',
    },
    include: {
      owner: true,
      workspace: true,
      item: true,
      artwork: true,
      members: {
        include: {
          asset: {
            include: {
              owner: true,
              workspace: true,
              item: true,
              artwork: true,
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return relationships.map(toBundleSummary);
}

export async function loadAssetBundleRelationship(userId: string, relationshipId: string) {
  const relationship = await findRelationship(userId, relationshipId);
  return relationship ? toBundleDetail(relationship) : null;
}

export async function deleteAssetBundleRelationship(userId: string, relationshipId: string) {
  const relationship = await findRelationship(userId, relationshipId);
  if (!relationship) return false;

  await prisma.relationship.delete({
    where: { id: relationship.id },
  });

  return true;
}

export async function getAssetBundleMembershipWarnings(assetObjectId: string) {
  const memberships = await prisma.relationshipMember.findMany({
    where: {
      asset: { assetId: assetObjectId },
      relationship: {
        relationshipType: RELATIONSHIP_TYPE,
        status: 'ACTIVE',
      },
    },
    include: {
      relationship: true,
    },
    orderBy: { sortOrder: 'asc' },
  });

  return memberships.map((membership) => ({
    relationshipId: membership.relationship.relationshipId,
    bundleName: membership.relationship.bundleName,
  }));
}

export async function createBundleExportPlanFromRelationship(
  userId: string,
  relationshipId: string,
  overrideTitle?: string
): Promise<BundlePlan | null> {
  const relationship = await findRelationship(userId, relationshipId);
  if (!relationship) return null;

  const warnings: string[] = [];
  const errors: string[] = [];
  const title = readString(overrideTitle) || relationship.bundleName;

  const members: BundlePlanMember[] = [];
  for (const [index, member] of relationship.members.entries()) {
    const asset = member.asset;
    const sourcePath = asset.filePath ? path.resolve(asset.filePath) : '';
    const folder = bundleFolderFor(asset.artwork.title, index);

    if (!sourcePath) {
      errors.push(`Bundle member asset has no file path: ${asset.assetId}`);
    } else {
      try {
        const stats = await fs.stat(sourcePath);
        if (!stats.isFile()) {
          errors.push(`Bundle member asset path is not a file: ${sourcePath}`);
        }
      } catch {
        errors.push(`Bundle member asset file is missing: ${sourcePath}`);
      }
    }

    const format = formatFromPath(sourcePath);
    members.push({
      sortOrder: index + 1,
      packageId: relationship.relationshipId,
      artworkId: asset.artwork.artworkNumber,
      profileId: asset.role,
      productTitle: asset.artwork.title,
      assetIds: [asset.assetId],
      sourceManifestPath: '',
      sourcePackagePath: '',
      bundleFolder: folder,
      includedFiles: sourcePath
        ? [
            {
              role: asset.role,
              sourcePath,
              bundlePath: normalizeRelativePath(path.join('members', folder, path.basename(sourcePath))),
              format,
              sizeBytes: 0,
              assetId: asset.assetId,
              ownerId: asset.owner.ownerId,
              workspaceId: asset.workspace.workspaceId,
              itemId: asset.item.itemId,
              artworkId: asset.artwork.artworkNumber,
            },
          ]
        : [],
      sku: relationship.relationshipId,
      readiness: null,
      productProfile: null,
    });
  }

  return {
    bundleId: relationship.relationshipId,
    title,
    slug: slugify(title),
    sku: relationship.relationshipId,
    memberCount: members.length,
    members,
    readiness: {
      allMembersPresent: relationship.members.length > 0,
      allSourceManifestsReadable: true,
      allFilesResolved: errors.length === 0,
    },
    warnings,
    errors,
  };
}

export default {
  createAssetBundleRelationship,
  listAssetBundleRelationships,
  loadAssetBundleRelationship,
  deleteAssetBundleRelationship,
  createBundleExportPlanFromRelationship,
  getAssetBundleMembershipWarnings,
};
