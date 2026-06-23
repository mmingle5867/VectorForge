import fs from 'fs/promises';
import path from 'path';
import type {
  ListingMediaGeneratedItem,
  ListingMediaSkippedItem,
} from '@/services/listing-media-generator';
import { findManifestPath } from '@/lib/output-naming';
import type {
  PackageFileEntry,
  PackageManifestV2,
  ProcessingHistoryEntry,
} from '@/lib/package-manifest-schema';

type ListingMediaManifestUpdateInput = {
  packageRoot: string;
  batchId: string;
  itemId: string;
  generated: ListingMediaGeneratedItem[];
  skipped: ListingMediaSkippedItem[];
  templateIds: string[];
  purpose?: string;
  assetProfile?: string;
  overwrite: boolean;
};

type ListingMediaManifestUpdateResult = {
  manifestUpdated: boolean;
  manifestPath: string | null;
  warnings: string[];
  errors: string[];
};

function normalizeRelativePath(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}

function pathExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function isPackageManifest(value: unknown): value is PackageManifestV2 {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as PackageManifestV2).schemaVersion === '2.0' &&
      (value as PackageManifestV2).package &&
      (value as PackageManifestV2).files
  );
}

function fileEntryKey(entry: Pick<PackageFileEntry, 'path' | 'templateId'>) {
  return `${(entry.templateId || '').trim()}::${(entry.path || '').trim()}`;
}

function upsertFileEntries(
  existing: PackageFileEntry[] | undefined,
  nextEntries: PackageFileEntry[]
) {
  const merged = Array.isArray(existing) ? [...existing] : [];
  for (const entry of nextEntries) {
    const key = fileEntryKey(entry);
    const index = merged.findIndex((candidate) => fileEntryKey(candidate) === key);
    if (index >= 0) {
      merged[index] = entry;
    } else {
      merged.push(entry);
    }
  }
  return merged;
}

function packagePathRelativeToRoot(packageRoot: string, filePath: string) {
  return normalizeRelativePath(path.relative(packageRoot, filePath));
}

function buildListingImageEntry(
  packageRoot: string,
  filePath: string,
  metadata: ListingMediaGeneratedItem['metadata']
): PackageFileEntry {
  return {
    role: metadata.role || 'main-image',
    path: packagePathRelativeToRoot(packageRoot, filePath),
    format: metadata.format || path.extname(filePath).replace('.', '').toLowerCase() || 'unknown',
    mimeType:
      metadata.format === 'jpg' || metadata.format === 'jpeg'
        ? 'image/jpeg'
        : metadata.format === 'png'
          ? 'image/png'
          : metadata.format === 'webp'
            ? 'image/webp'
            : 'application/octet-stream',
    sizeBytes: 0,
    width: metadata.width || null,
    height: metadata.height || null,
    assetProfile: metadata.assetProfile || '',
    templateId: metadata.templateId || '',
    slot: metadata.slot ?? null,
    sha256: '',
    fingerprint: '',
  };
}

function appendProcessingHistory(
  existing: ProcessingHistoryEntry[] | undefined,
  input: ListingMediaManifestUpdateInput
) {
  const nextEntry: ProcessingHistoryEntry = {
    step: 'listing-media-generated',
    app: 'VectorForge',
    appVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    settings: {
      templateIds: input.templateIds,
      purpose: input.purpose || '',
      assetProfile: input.assetProfile || '',
      overwrite: input.overwrite,
    },
  };

  return [...(Array.isArray(existing) ? existing : []), nextEntry];
}

async function buildManifestFileEntries(
  packageRoot: string,
  items: Array<ListingMediaGeneratedItem | ListingMediaSkippedItem>
) {
  const entries: PackageFileEntry[] = [];

  for (const item of items) {
    const outputPath = item.outputPath;
    if (!(await pathExists(outputPath))) continue;

    const stats = await fs.stat(outputPath).catch(() => null);
    if (!stats || !stats.isFile()) continue;

    const metadata = item.metadata;
    if (!metadata) continue;

    entries.push({
      ...buildListingImageEntry(packageRoot, outputPath, metadata),
      sizeBytes: stats.size,
    });
  }

  return entries;
}

export async function updateListingMediaManifest(
  input: ListingMediaManifestUpdateInput
): Promise<ListingMediaManifestUpdateResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const manifestPath = await findManifestPath(input.packageRoot);
  if (!manifestPath) {
    warnings.push(`Package manifest not found for listing media update: ${input.packageRoot}`);
    return { manifestUpdated: false, manifestPath: null, warnings, errors };
  }

  const manifestRelativePath = packagePathRelativeToRoot(input.packageRoot, manifestPath);
  if (manifestRelativePath.startsWith('_internal/')) {
    // V2 manifest. Continue.
  } else if (manifestRelativePath === 'manifest.json') {
    warnings.push(`Package manifest is legacy V1 and was not updated: ${manifestPath}`);
    return { manifestUpdated: false, manifestPath: manifestRelativePath, warnings, errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  } catch (error) {
    errors.push(
      `Package manifest unreadable for listing media update: ${manifestPath} (${error instanceof Error ? error.message : String(error)})`
    );
    return { manifestUpdated: false, manifestPath: manifestRelativePath, warnings, errors };
  }

  if (!isPackageManifest(parsed)) {
    errors.push(`Unsupported manifest format for listing media update: ${manifestPath}`);
    return { manifestUpdated: false, manifestPath: manifestRelativePath, warnings, errors };
  }

  const manifest = parsed;
  const listingImageEntries = await buildManifestFileEntries(input.packageRoot, [
    ...input.generated,
    ...input.skipped,
  ]);

  if (listingImageEntries.length === 0) {
    warnings.push('No generated listing media files were found on disk for manifest update.');
    return { manifestUpdated: false, manifestPath: manifestRelativePath, warnings, errors };
  }

  const nextListingImages = upsertFileEntries(manifest.files.listingImages, listingImageEntries);
  const nextManifest: PackageManifestV2 = {
    ...manifest,
    files: {
      ...manifest.files,
      listingImages: nextListingImages,
    },
    readiness: {
      ...manifest.readiness,
      imagesComplete: nextListingImages.length > 0,
      readyForListingTool:
        Boolean(manifest.readiness.filesComplete) &&
        Boolean(manifest.readiness.downloadsComplete) &&
        nextListingImages.length > 0,
    },
    processingHistory: appendProcessingHistory(manifest.processingHistory, input),
  };

  try {
    await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf-8');
    return {
      manifestUpdated: true,
      manifestPath: manifestRelativePath,
      warnings,
      errors,
    };
  } catch (error) {
    errors.push(
      `Package manifest update failed: ${manifestPath} (${error instanceof Error ? error.message : String(error)})`
    );
    return {
      manifestUpdated: false,
      manifestPath: manifestRelativePath,
      warnings,
      errors,
    };
  }
}

export default { updateListingMediaManifest };
