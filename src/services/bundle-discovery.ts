import fs from 'fs/promises';
import path from 'path';
import type { PackageManifestV2, BundleMember, BundleIncludedFile } from '@/lib/package-manifest-schema';

export type BundleMemberSummary = BundleMember & {
  thumbnailPath: string | null;
  includedFiles: BundleIncludedFile[];
};

export type BundleSummary = {
  bundleId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  bundleFolderName: string;
  bundleFolderPath: string;
  manifestPath: string;
  zipPath: string | null;
  zipFolderPath: string | null;
  manifestStatus: 'present' | 'missing';
  zipStatus: 'present' | 'missing';
  packageStatus: string;
  thumbnailPath: string | null;
};

export type BundleDetail = BundleSummary & {
  manifest: PackageManifestV2;
  members: BundleMemberSummary[];
  readmePath: string | null;
  licensePath: string | null;
};

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function pathExists(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isPackageManifest(value: unknown): value is PackageManifestV2 {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<PackageManifestV2>;
  return manifest.schemaVersion === '2.0' && Boolean(manifest.package);
}

async function readManifest(manifestPath: string) {
  const raw = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

async function collectBundleManifestPaths(root: string) {
  const manifestPaths: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '_internal') {
          const manifestPath = path.join(entryPath, 'manifest.json');
          if (await pathExists(manifestPath) && !seen.has(manifestPath)) {
            seen.add(manifestPath);
            manifestPaths.push(manifestPath);
          }
          continue;
        }

        if (current.depth < 4) {
          queue.push({ dir: entryPath, depth: current.depth + 1 });
        }
      }
    }
  }

  return manifestPaths.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

function resolveBundleRoot(manifestPath: string) {
  return path.dirname(path.dirname(manifestPath));
}

function resolveBundleThumbnailPath(manifest: PackageManifestV2, manifestPath: string) {
  const members = Array.isArray(manifest.members) ? manifest.members : [];
  for (const member of members) {
    const includedFiles = Array.isArray(member.includedFiles) ? member.includedFiles : [];
    const firstFile = includedFiles.find((file) => readString(file.bundlePath));
    if (firstFile?.bundlePath) {
      return normalizeRelativePath(firstFile.bundlePath);
    }
  }

  const artworkFiles = Array.isArray(manifest.files?.artwork) ? manifest.files.artwork : [];
  const firstArtwork = artworkFiles.find((file) => readString(file.path));
  if (firstArtwork?.path) {
    const relative = normalizeRelativePath(firstArtwork.path);
    const fromManifestRoot = path.resolve(path.dirname(manifestPath), relative);
    return normalizeRelativePath(path.relative(resolveBundleRoot(manifestPath), fromManifestRoot));
  }

  return null;
}

function buildSummary(manifestPath: string, manifest: PackageManifestV2): BundleSummary {
  const bundleRootPath = resolveBundleRoot(manifestPath);
  const bundleFolderName = path.basename(bundleRootPath);
  const bundle = readObject(manifest.bundle);
  const zipRelativePath = readString(bundle.zipPath);
  const zipPath = zipRelativePath
    ? path.resolve(path.dirname(manifestPath), zipRelativePath)
    : null;
  const zipFolderPath = zipPath ? path.dirname(zipPath) : null;
  const thumbnailPath = resolveBundleThumbnailPath(manifest, manifestPath);

  return {
    bundleId: readString(bundle.bundleId) || readString(manifest.package?.packageId),
    title: readString(bundle.title) || readString(manifest.artwork?.title) || bundleFolderName,
    createdAt: manifest.createdAt || '',
    updatedAt: manifest.updatedAt || '',
    memberCount: Number(bundle.memberCount) || (Array.isArray(manifest.members) ? manifest.members.length : 0),
    bundleFolderName,
    bundleFolderPath: bundleRootPath,
    manifestPath,
    zipPath,
    zipFolderPath,
    manifestStatus: 'present',
    zipStatus: 'missing',
    packageStatus: readString(manifest.package?.packageStatus) || 'generated',
    thumbnailPath,
  };
}

async function resolveZipStatus(zipPath: string | null) {
  if (!zipPath) return 'missing' as const;
  return (await pathExists(zipPath)) ? 'present' : 'missing';
}

function buildMemberSummaries(manifest: PackageManifestV2) {
  return (Array.isArray(manifest.members) ? manifest.members : []).map((member) => ({
    ...member,
    thumbnailPath: member.includedFiles?.find((file) => readString(file.bundlePath))?.bundlePath || null,
    includedFiles: member.includedFiles || [],
  }));
}

export async function discoverBundles(bundleOutputPath: string) {
  const manifestPaths = await collectBundleManifestPaths(bundleOutputPath);
  const bundles: BundleSummary[] = [];
  const warnings: string[] = [];

  for (const manifestPath of manifestPaths) {
    try {
      const parsed = await readManifest(manifestPath);
      if (!isPackageManifest(parsed)) {
        warnings.push(`Skipping unsupported manifest: ${manifestPath}`);
        continue;
      }

      const manifest = parsed;
      if (manifest.package?.packageType !== 'bundle-package') {
        warnings.push(`Skipping non-bundle manifest: ${manifestPath}`);
        continue;
      }

      const summary = buildSummary(manifestPath, manifest);
      summary.zipStatus = await resolveZipStatus(summary.zipPath);
      summary.manifestStatus = (await pathExists(manifestPath)) ? 'present' : 'missing';
      bundles.push(summary);
    } catch (error) {
      warnings.push(`Skipping bundle manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { bundles, warnings };
}

export async function loadBundleById(bundleOutputPath: string, bundleId: string) {
  const { bundles } = await discoverBundles(bundleOutputPath);
  const summary = bundles.find((bundle) => bundle.bundleId === bundleId);
  if (!summary) return null;

  const manifest = (await readManifest(summary.manifestPath)) as PackageManifestV2;
  if (manifest.package?.packageType !== 'bundle-package') {
    return null;
  }
  const readmePath = path.resolve(path.dirname(summary.manifestPath), '../metadata/README.txt');
  const licensePath = path.resolve(path.dirname(summary.manifestPath), '../metadata/LICENSE.txt');

  return {
    ...summary,
    manifest,
    members: buildMemberSummaries(manifest),
    readmePath: (await pathExists(readmePath)) ? readmePath : null,
    licensePath: (await pathExists(licensePath)) ? licensePath : null,
  };
}

export async function findBundleByBundleId(bundleOutputPath: string, bundleId: string) {
  const { bundles } = await discoverBundles(bundleOutputPath);
  return bundles.find((bundle) => bundle.bundleId === bundleId) || null;
}
