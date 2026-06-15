import { access, readdir } from 'fs/promises';
import path from 'path';
import { getInternalManifestPath } from '@/lib/package-structure';

export type PackageStructureVersion = 'v1' | 'v2';

function normalizeExtension(extension: string) {
  return extension.startsWith('.') ? extension : `.${extension}`;
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getPackageBaseName(itemOutputDir: string) {
  return path.basename(itemOutputDir);
}

export function getPackageFileName(itemOutputDir: string, extension: string) {
  return `${getPackageBaseName(itemOutputDir)}${normalizeExtension(extension)}`;
}

export function getPackageFilePath(itemOutputDir: string, extension: string) {
  return path.join(itemOutputDir, getPackageFileName(itemOutputDir, extension));
}

export async function getUniqueFilePath(folder: string, baseName: string, extension: string) {
  const ext = normalizeExtension(extension);
  let candidate = path.join(folder, `${baseName}${ext}`);
  let index = 1;

  while (await pathExists(candidate)) {
    candidate = path.join(folder, `${baseName}-${index}${ext}`);
    index += 1;
  }

  return candidate;
}

export function getZipPath(itemOutputDir: string) {
  return getPackageFilePath(itemOutputDir, '.zip');
}

export function getSvgPath(itemOutputDir: string) {
  return getPackageFilePath(itemOutputDir, '.svg');
}

export function getPngPath(itemOutputDir: string) {
  return getPackageFilePath(itemOutputDir, '.png');
}

export function getJpgPath(itemOutputDir: string) {
  return getPackageFilePath(itemOutputDir, '.jpg');
}

export function getListingInfoPath(itemOutputDir: string) {
  return path.join(itemOutputDir, `${getPackageBaseName(itemOutputDir)}-listing-info.txt`);
}

export function getMarketplacePreviewPath(itemOutputDir: string) {
  return path.join(itemOutputDir, `${getPackageBaseName(itemOutputDir)}-preview.jpg`);
}

export function getManifestPath(itemOutputDir: string) {
  return path.join(itemOutputDir, 'manifest.json');
}

export function getPackageManifestPath(
  itemOutputDir: string,
  options?: { structureVersion?: PackageStructureVersion }
) {
  return options?.structureVersion === 'v2'
    ? getInternalManifestPath(itemOutputDir)
    : getManifestPath(itemOutputDir);
}

export async function findManifestPath(itemOutputDir: string) {
  const candidates = [
    getPackageManifestPath(itemOutputDir, { structureVersion: 'v2' }),
    getPackageManifestPath(itemOutputDir, { structureVersion: 'v1' }),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getReadmePath(itemOutputDir: string) {
  return path.join(itemOutputDir, 'README.txt');
}

export function getLicensePath(itemOutputDir: string) {
  return path.join(itemOutputDir, 'LICENSE.txt');
}

export function getOriginalSourcePath(itemOutputDir: string, extension: string) {
  return path.join(
    itemOutputDir,
    `${getPackageBaseName(itemOutputDir)}-original${normalizeExtension(extension)}`
  );
}

export async function findExistingFilePath(candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) {
      return candidate;
    }
  }
  return candidates.find((candidate): candidate is string => !!candidate) || null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findExistingNamedFilePath(
  folder: string | null | undefined,
  baseNames: string[],
  extension: string
) {
  if (!folder) return null;

  const ext = normalizeExtension(extension);
  const exactCandidates = baseNames.map((baseName) => path.join(folder, `${baseName}${ext}`));
  const exactMatch = await findExistingFilePath(exactCandidates);
  if (exactMatch && await pathExists(exactMatch)) {
    return exactMatch;
  }

  try {
    const entries = await readdir(folder);
    for (const baseName of baseNames) {
      const pattern = new RegExp(`^${escapeRegExp(baseName)}-\\d+${escapeRegExp(ext)}$`, 'i');
      const match = entries
        .filter((entry) => pattern.test(entry))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
      if (match) {
        return path.join(folder, match);
      }
    }
  } catch {
    return exactCandidates[0] || null;
  }

  return exactCandidates[0] || null;
}
