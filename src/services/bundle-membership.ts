import fs from 'fs/promises';
import path from 'path';
import type {
  BundleMembershipMarker,
  PackageManifestV2,
} from '@/lib/package-manifest-schema';

type BundleMembershipUpdateInput = {
  bundleId: string;
  bundleTitle: string;
  bundleManifestPath: string;
  members: Array<{
    sourceManifestPath: string;
    sourcePackagePath: string;
  }>;
};

type BundleMembershipUpdateResult = {
  warnings: string[];
  updatedManifests: string[];
};

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPackageManifest(value: unknown): value is PackageManifestV2 {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as PackageManifestV2).schemaVersion === '2.0' &&
      (value as PackageManifestV2).package
  );
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveRelativeBundleManifestPath(sourcePackagePath: string, bundleManifestPath: string) {
  const relative = path.relative(sourcePackagePath, bundleManifestPath);
  if (!relative || path.isAbsolute(relative)) return '';
  return normalizeRelativePath(relative);
}

function upsertBundleMembership(
  existing: BundleMembershipMarker[] | undefined,
  marker: BundleMembershipMarker
) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const index = list.findIndex((entry) => readString(entry.bundleId) === marker.bundleId);

  if (index >= 0) {
    list[index] = marker;
    return list;
  }

  list.push(marker);
  return list;
}

export async function updateBundleMembershipMarkers(
  input: BundleMembershipUpdateInput
): Promise<BundleMembershipUpdateResult> {
  const warnings: string[] = [];
  const updatedManifests: string[] = [];

  if (!(await pathExists(input.bundleManifestPath))) {
    warnings.push(`Bundle manifest missing for membership update: ${input.bundleManifestPath}`);
    return { warnings, updatedManifests };
  }

  const markerTemplate: BundleMembershipMarker = {
    bundleId: input.bundleId,
    bundleTitle: input.bundleTitle,
    bundleManifestPath: '',
    status: 'active',
    addedAt: new Date().toISOString(),
  };

  for (const member of input.members) {
    const manifestPath = member.sourceManifestPath;

    if (!(await pathExists(manifestPath))) {
      warnings.push(`Bundle membership marker skipped; source manifest missing: ${manifestPath}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    } catch (error) {
      warnings.push(
        `Bundle membership marker skipped; source manifest unreadable: ${manifestPath} (${error instanceof Error ? error.message : String(error)})`
      );
      continue;
    }

    if (!isPackageManifest(parsed)) {
      warnings.push(`Bundle membership marker skipped; unsupported manifest format: ${manifestPath}`);
      continue;
    }

    const manifest = parsed;
    const sourcePackagePath = path.resolve(member.sourcePackagePath);
    const relativeMarkerPath = resolveRelativeBundleManifestPath(sourcePackagePath, input.bundleManifestPath);
    const marker: BundleMembershipMarker = {
      ...markerTemplate,
      bundleManifestPath: relativeMarkerPath || input.bundleId,
    };
    const nextManifest = {
      ...manifest,
      bundleMembership: upsertBundleMembership(manifest.bundleMembership, marker),
    } satisfies PackageManifestV2;

    try {
      await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf-8');
      updatedManifests.push(manifestPath);
    } catch (error) {
      warnings.push(
        `Bundle membership marker update failed for ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return { warnings, updatedManifests };
}

export default { updateBundleMembershipMarkers };
