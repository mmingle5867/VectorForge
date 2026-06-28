import fs from 'fs/promises';
import path from 'path';
import packageJson from '../../package.json';
import prisma from '@/lib/prisma';
import config from '@/lib/config';
import {
  getPackageManifestPath,
  type PackageStructureVersion,
} from '@/lib/output-naming';
import type {
  AssetProfileEntry,
  PackageFileEntry,
  PackageManifestV2,
  ListingMetadata,
  ProductProfileEntry,
  SupplementalFileEntry,
} from '@/lib/package-manifest-schema';

type ManifestInput = {
  outputDir: string;
  item: {
    id?: string | null;
    originalFilename: string;
    baseName: string;
    mimeType: string | null;
    uploadPath: string | null;
    artworkId?: string | null;
    assetProfileId?: string | null;
    artworkNumber?: string | null;
    profileNumber?: string | null;
  };
  sku: string;
  svgPath: string | null;
  pngPath: string | null;
  jpgPath: string | null;
  marketplacePreviewPath: string | null;
  metadataPath: string | null;
  skuFilePath: string | null;
  readmePath?: string | null;
  licensePath?: string | null;
  zipPath?: string | null;
  licenseType?: string | null;
  structureVersion?: PackageStructureVersion;
};

type ManifestSemaContext = {
  ownerId: string;
  workspaceId: string;
  itemId: string;
  artworkId: string;
  assetIds: string[];
  assetByRole: Record<string, string>;
} | null;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatFromPath(filePath: string) {
  return path.extname(filePath).replace('.', '').toLowerCase() || 'unknown';
}

function mimeTypeFor(format: string) {
  const types: Record<string, string> = {
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    txt: 'text/plain',
    json: 'application/json',
    zip: 'application/zip',
  };
  return types[format] || 'application/octet-stream';
}

function createEmptyListingMetadata(): ListingMetadata {
  return {
    title: '',
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
  };
}

function safePackageIdSegment(value: string | null | undefined) {
  return (value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildPackageId(input: ManifestInput, artworkId: string, profileId: string, createdAt: string) {
  const safeArtworkId = safePackageIdSegment(artworkId);
  const safeProfileId = safePackageIdSegment(profileId);

  if (safeArtworkId && safeProfileId) {
    return `PKG-${safeArtworkId}-${safeProfileId}`;
  }

  if (safeArtworkId || safeProfileId) {
    return `PKG-${safeArtworkId || 'UNASSIGNED'}-${safeProfileId || 'UNASSIGNED'}`;
  }

  return `PKG-UNASSIGNED-${safePackageIdSegment(input.item.id) || createdAt.replace(/[^0-9]/g, '')}`;
}

function relativePackagePath(outputDir: string, filePath: string | null | undefined) {
  if (!filePath) return null;

  const relativePath = path.relative(outputDir, filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return relativePath.split(path.sep).join('/');
}

function localSourcePath(filePath: string) {
  const relativePath = path.relative(process.cwd(), filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return filePath;
  }

  return relativePath.split(path.sep).join('/');
}

async function fileEntry(
  outputDir: string,
  filePath: string | null | undefined,
  role: string,
  fallbackMimeType?: string | null,
  metadata?: Partial<PackageFileEntry>,
  options?: { allowExternalPath?: boolean }
): Promise<PackageFileEntry | null> {
  const relativePath = relativePackagePath(outputDir, filePath);
  if ((!relativePath && !options?.allowExternalPath) || !filePath) return null;

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return null;

    const format = formatFromPath(filePath);
    const manifestPath = relativePath || localSourcePath(filePath);
    return {
      role,
      path: manifestPath,
      format,
      mimeType: fallbackMimeType || mimeTypeFor(format),
      sizeBytes: stats.size,
      sha256: '',
      fingerprint: '',
      width: null,
      height: null,
      assetProfile: 'digital',
      templateId: '',
      slot: null,
      ...metadata,
    };
  } catch {
    return null;
  }
}

async function collectEntries(entries: Array<Promise<PackageFileEntry | null>>) {
  return (await Promise.all(entries)).filter((entry): entry is PackageFileEntry => Boolean(entry));
}

async function getManifestSemaContext(input: ManifestInput): Promise<ManifestSemaContext> {
  if (!input.item.id) return null;

  const batchItem = await prisma.batchItem.findUnique({
    where: { id: input.item.id },
    include: {
      owner: true,
      workspace: true,
      semaItem: true,
      artwork: true,
      assets: true,
    },
  });

  if (!batchItem?.owner || !batchItem.workspace || !batchItem.semaItem || !batchItem.artwork) {
    return null;
  }

  return {
    ownerId: batchItem.owner.ownerId,
    workspaceId: batchItem.workspace.workspaceId,
    itemId: batchItem.semaItem.itemId,
    artworkId: batchItem.artwork.artworkNumber,
    assetIds: batchItem.assets.map((asset) => asset.assetId),
    assetByRole: Object.fromEntries(batchItem.assets.map((asset) => [asset.role, asset.assetId])),
  };
}

function semaFileMetadata(context: ManifestSemaContext, role: string) {
  if (!context) return {};

  return {
    ownerId: context.ownerId,
    workspaceId: context.workspaceId,
    itemId: context.itemId,
    artworkId: context.artworkId,
    assetId: context.assetByRole[role] || '',
  };
}

async function writeManifestWithSelfEntry(
  manifestPath: string,
  manifest: PackageManifestV2,
  manifestRelativePath: string,
  metadata?: Partial<PackageFileEntry>
) {
  let nextManifest = manifest;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf-8');
    const stats = await fs.stat(manifestPath);
    const files = nextManifest.files as { package: PackageFileEntry[] };
    const packageFiles = files.package.filter((entry) => entry.role !== 'manifest');
    const manifestEntry: PackageFileEntry = {
      role: 'manifest',
      path: manifestRelativePath,
      format: 'json',
      mimeType: 'application/json',
      sizeBytes: stats.size,
      sha256: '',
      fingerprint: '',
      width: null,
      height: null,
      assetProfile: '',
      templateId: '',
      slot: null,
      ...metadata,
    };
    const updatedManifest = {
      ...nextManifest,
      files: {
        ...nextManifest.files,
        package: [...packageFiles, manifestEntry],
      },
    };

    if (JSON.stringify(updatedManifest) === JSON.stringify(nextManifest)) {
      return;
    }

    nextManifest = updatedManifest;
  }

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf-8');
}

export async function generatePackageManifest(input: ManifestInput) {
  const manifestPath = getPackageManifestPath(input.outputDir, {
    structureVersion: input.structureVersion,
  });
  const manifestRelativePath =
    relativePackagePath(input.outputDir, manifestPath) || 'manifest.json';
  const createdAt = new Date().toISOString();
  const semaContext = await getManifestSemaContext(input);
  const artworkId = input.item.artworkNumber || input.item.artworkId || '';
  const profileId = input.item.profileNumber || input.item.assetProfileId || '';
  const primarySku = input.item.profileNumber || input.sku || '';
  const packageId = buildPackageId(input, artworkId, profileId, createdAt);
  const metadataEntries = await collectEntries([
    fileEntry(input.outputDir, input.metadataPath, 'listing-info', null, semaFileMetadata(semaContext, 'metadata')),
    fileEntry(input.outputDir, input.skuFilePath, 'sku-file', null, semaFileMetadata(semaContext, 'sku-file')),
    fileEntry(input.outputDir, input.readmePath, 'readme', null, semaFileMetadata(semaContext, 'metadata')),
    fileEntry(input.outputDir, input.licensePath, 'license', null, semaFileMetadata(semaContext, 'metadata')),
  ]);
  const listingPreviewEntry = await fileEntry(
    input.outputDir,
    input.marketplacePreviewPath,
    'listing-preview',
    null,
    {
      templateId: 'listing-preview',
      slot: 1,
      ...semaFileMetadata(semaContext, 'preview'),
    }
  );
  const artworkEntries = await collectEntries([
    fileEntry(input.outputDir, input.svgPath, 'primary-svg', null, semaFileMetadata(semaContext, 'primary-svg')),
    fileEntry(input.outputDir, input.pngPath, 'primary-png', null, semaFileMetadata(semaContext, 'primary-png')),
    fileEntry(input.outputDir, input.jpgPath, 'primary-jpg', null, semaFileMetadata(semaContext, 'primary-jpg')),
  ]);
  const sourceEntries = await collectEntries([
    fileEntry(input.outputDir, input.item.uploadPath, 'original-upload', input.item.mimeType, {
      assetProfile: '',
      ...semaFileMetadata(semaContext, 'source-file'),
    }, { allowExternalPath: true }),
  ]);
  const downloadEntries = await collectEntries([
    fileEntry(input.outputDir, input.zipPath, 'customer-zip', null, semaFileMetadata(semaContext, 'customer-zip')),
  ]);
  const supplementalFiles: SupplementalFileEntry[] = [];
  const assetProfile: AssetProfileEntry = {
    profileType: 'digital',
    profileId,
    assetId: semaContext?.assetByRole['primary-svg'] || '',
    itemId: semaContext?.itemId || '',
    artworkId: semaContext?.artworkId || artworkId,
    status: 'completed',
    primarySku,
    folder: '.',
  };
  const productProfile: ProductProfileEntry = {
    ...assetProfile,
    productProfileId: profileId,
  };
  const filesComplete = artworkEntries.length > 0 && metadataEntries.length > 0;
  const imagesComplete = Boolean(listingPreviewEntry);
  const downloadsComplete = downloadEntries.length > 0;
  const readyForListingTool = filesComplete && downloadsComplete;

  const manifest: PackageManifestV2 = {
    schemaVersion: '2.0',
    sourceApp: config.identity.sourceId,
    appVersion: packageJson.version,
    sourceAppVersion: packageJson.version,
    sourceSystem: config.identity.slug,
    createdAt,
    updatedAt: createdAt,
    sema: semaContext
      ? {
          OwnerID: semaContext.ownerId,
          WorkspaceID: semaContext.workspaceId,
          ItemID: semaContext.itemId,
          ArtworkID: semaContext.artworkId,
          AssetIDs: semaContext.assetIds,
          sourceApp: config.identity.sourceId,
          createdAt,
          updatedAt: createdAt,
        }
      : undefined,

    package: {
      packageId,
      packageType: 'digital-product-package',
      packageStatus: 'generated',
    },

    owner: {
      companyId: '',
      brandId: '',
      createdByUserId: '',
      ownerId: semaContext?.ownerId || '',
      workspaceId: semaContext?.workspaceId || '',
    },

    externalRefs: {
      sourceJobId: '',
      listingToolProductId: '',
    },

    artwork: {
      artworkId: semaContext?.artworkId || artworkId,
      title: input.item.baseName || '',
      slug: slugify(input.item.baseName || ''),
      sourceFileName: input.item.originalFilename || '',
      sourceType: input.item.mimeType?.includes('svg') ? 'svg' : 'raster',
      inputFormat: formatFromPath(input.item.originalFilename || ''),
    },

    assetProfiles: [assetProfile],

    productProfiles: [productProfile],

    productVariants: [
      {
        sku: primarySku,
        profileType: 'digital',
        variantType: 'digital-download',
        options: {},
        price: null,
        quantity: null,
      },
    ],

    files: {
      source: sourceEntries,
      artwork: artworkEntries,
      downloads: downloadEntries,
      listingImages: listingPreviewEntry ? [listingPreviewEntry] : [],
      compositeImages: [],
      metadata: metadataEntries,
      package: [],
    },
    supplementalFiles,

    listing: createEmptyListingMetadata(),

    rights: {
      ownership: '',
      commercialUseAllowed: null,
      resaleAllowed: null,
      licenseType: input.licenseType || '',
      sourceNotes: '',
    },

    readiness: {
      artworkApproved: true,
      filesComplete,
      listingCopyComplete: false,
      imagesComplete,
      downloadsComplete,
      readyForListingTool,
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

    processingHistory: [
      {
        step: 'package-finalized',
        app: config.identity.sourceId,
        appVersion: packageJson.version,
        timestamp: createdAt,
        settings: {},
      },
    ],

    extensions: {
      listingTool: {},
      analytics: {},
      accounting: {},
      marketplaceSync: {},
    },

    generation: {
      status: 'completed',
      workflowStatus: 'COMPLETED',
      generatedBy: config.identity.sourceId,
      notes: [],
    },
  };

  await writeManifestWithSelfEntry(
    manifestPath,
    manifest,
    manifestRelativePath,
    semaFileMetadata(semaContext, 'metadata')
  );
  return manifestPath;
}
