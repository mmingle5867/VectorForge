import fs from 'fs/promises';
import path from 'path';
import packageJson from '../../package.json';
import {
  getPackageManifestPath,
  type PackageStructureVersion,
} from '@/lib/output-naming';

type ManifestFileEntry = {
  role: string;
  path: string;
  format: string;
  mimeType: string;
  sizeBytes: number;
};

type ManifestInput = {
  outputDir: string;
  item: {
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
  fallbackMimeType?: string | null
): Promise<ManifestFileEntry | null> {
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
    };
  } catch {
    return null;
  }
}

async function collectEntries(entries: Array<Promise<ManifestFileEntry | null>>) {
  return (await Promise.all(entries)).filter((entry): entry is ManifestFileEntry => Boolean(entry));
}

async function writeManifestWithSelfEntry(
  manifestPath: string,
  manifest: Record<string, unknown>,
  manifestRelativePath: string
) {
  let nextManifest = manifest;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf-8');
    const stats = await fs.stat(manifestPath);
    const files = nextManifest.files as { package: ManifestFileEntry[] };
    const packageFiles = files.package.filter((entry) => entry.role !== 'manifest');
    const manifestEntry: ManifestFileEntry = {
      role: 'manifest',
      path: manifestRelativePath,
      format: 'json',
      mimeType: 'application/json',
      sizeBytes: stats.size,
    };
    const updatedManifest = {
      ...nextManifest,
      files: {
        ...(nextManifest.files as Record<string, unknown>),
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
  const metadataEntries = await collectEntries([
    fileEntry(input.outputDir, input.metadataPath, 'listing-info'),
    fileEntry(input.outputDir, input.skuFilePath, 'sku-file'),
    fileEntry(input.outputDir, input.readmePath, 'readme'),
    fileEntry(input.outputDir, input.licensePath, 'license'),
  ]);
  const listingPreviewEntry = await fileEntry(
    input.outputDir,
    input.marketplacePreviewPath,
    'marketplace-preview'
  );
  const artworkEntries = await collectEntries([
    fileEntry(input.outputDir, input.svgPath, 'primary-svg'),
    fileEntry(input.outputDir, input.pngPath, 'primary-png'),
    fileEntry(input.outputDir, input.jpgPath, 'primary-jpg'),
  ]);
  const sourceEntries = await collectEntries([
    fileEntry(input.outputDir, input.item.uploadPath, 'original-upload', input.item.mimeType),
  ]);

  const manifest = {
    schemaVersion: '1.0',
    sourceApp: 'VectorForge',
    appVersion: packageJson.version,
    createdAt,
    updatedAt: createdAt,

    artwork: {
      artworkId,
      title: input.item.baseName || '',
      slug: slugify(input.item.baseName || ''),
      sourceFileName: input.item.originalFilename || '',
      sourceType: input.item.mimeType?.includes('svg') ? 'svg' : 'raster',
      inputFormat: formatFromPath(input.item.originalFilename || ''),
    },

    assetProfiles: [
      {
        profileType: 'digital',
        profileId,
        status: 'completed',
        primarySku,
        folder: '.',
      },
    ],

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
      downloads: [],
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
        maxImages: 20,
        maxVideos: 2,
        images: listingPreviewEntry ? [listingPreviewEntry.path] : [],
        videos: [],
        digitalFiles: [],
      },
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
