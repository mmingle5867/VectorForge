import fs from 'fs/promises';
import path from 'path';
import packageJson from '../../package.json';
import {
  getPackageManifestPath,
  type PackageStructureVersion,
} from '@/lib/output-naming';
import type {
  AssetProfileEntry,
  PackageFileEntry,
  PackageManifestV2,
  ProductProfileEntry,
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

async function fileEntry(
  outputDir: string,
  filePath: string | null | undefined,
  role: string,
  fallbackMimeType?: string | null,
  metadata?: Partial<PackageFileEntry>
): Promise<PackageFileEntry | null> {
  const relativePath = relativePackagePath(outputDir, filePath);
  if (!relativePath || !filePath) return null;

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return null;

    const format = formatFromPath(filePath);
    return {
      role,
      path: relativePath,
      format,
      mimeType: fallbackMimeType || mimeTypeFor(format),
      sizeBytes: stats.size,
      sha256: '',
      fingerprint: '',
      width: null,
      height: null,
      assetProfile: 'digital',
      marketplace: '',
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

async function writeManifestWithSelfEntry(
  manifestPath: string,
  manifest: PackageManifestV2,
  manifestRelativePath: string
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
      marketplace: '',
      templateId: '',
      slot: null,
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
  const artworkId = input.item.artworkNumber || input.item.artworkId || '';
  const profileId = input.item.profileNumber || input.item.assetProfileId || '';
  const primarySku = input.item.profileNumber || input.sku || '';
  const packageId = buildPackageId(input, artworkId, profileId, createdAt);
  const metadataEntries = await collectEntries([
    fileEntry(input.outputDir, input.metadataPath, 'listing-info'),
    fileEntry(input.outputDir, input.skuFilePath, 'sku-file'),
    fileEntry(input.outputDir, input.readmePath, 'readme'),
    fileEntry(input.outputDir, input.licensePath, 'license'),
  ]);
  const listingPreviewEntry = await fileEntry(
    input.outputDir,
    input.marketplacePreviewPath,
    'marketplace-preview',
    null,
    {
      marketplace: 'etsy',
      templateId: 'marketplace-preview',
      slot: 1,
    }
  );
  const artworkEntries = await collectEntries([
    fileEntry(input.outputDir, input.svgPath, 'primary-svg'),
    fileEntry(input.outputDir, input.pngPath, 'primary-png'),
    fileEntry(input.outputDir, input.jpgPath, 'primary-jpg'),
  ]);
  const sourceEntries = await collectEntries([
    fileEntry(input.outputDir, input.item.uploadPath, 'original-upload', input.item.mimeType, {
      assetProfile: '',
    }),
  ]);
  const downloadEntries = await collectEntries([
    fileEntry(input.outputDir, input.zipPath, 'customer-zip'),
  ]);
  const assetProfile: AssetProfileEntry = {
    profileType: 'digital',
    profileId,
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
    sourceApp: 'VectorForge',
    appVersion: packageJson.version,
    createdAt,
    updatedAt: createdAt,

    package: {
      packageId,
      packageType: 'digital-product-package',
      packageStatus: 'generated',
    },

    owner: {
      companyId: '',
      brandId: '',
      createdByUserId: '',
    },

    externalRefs: {
      vectorForgeJobId: '',
      listingToolProductId: '',
      etsyListingId: '',
      shopifyProductId: '',
      bigCommerceProductId: '',
    },

    artwork: {
      artworkId,
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

    listing: {
      title: input.item.baseName || '',
      descriptionFile:
        metadataEntries.find((entry) => entry.role === 'listing-info')?.path || '',
      tags: [],
      materials: [],
      category: '',
      isDigital: true,
    },

    marketplaces: {
      etsy: {
        ready: false,
        profileId,
        maxImages: 20,
        maxVideos: 2,
        requiredImages: 1,
        requiredDigitalFiles: 1,
        validationErrors: [],
        images: listingPreviewEntry ? [listingPreviewEntry.path] : [],
        videos: [],
        digitalFiles: downloadEntries.map((entry) => entry.path),
      },
    },

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
        app: 'VectorForge',
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
      generatedBy: 'VectorForge',
      notes: [],
    },
  };

  await writeManifestWithSelfEntry(manifestPath, manifest, manifestRelativePath);
  return manifestPath;
}
