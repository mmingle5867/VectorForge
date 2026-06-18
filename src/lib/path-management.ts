import path from 'path';

export type ManagedPathType =
  | 'workingPath'
  | 'uploadPath'
  | 'outputPath'
  | 'bundleOutputPath'
  | 'archivePath'
  | 'baseAssetsPath'
  | 'templatePath';

export const DEFAULT_MANAGED_PATHS: Record<ManagedPathType, string> = {
  workingPath: './.vectorforge-work',
  uploadPath: './uploads',
  outputPath: './output',
  bundleOutputPath: './output/bundles',
  archivePath: './archive',
  baseAssetsPath: './base-assets',
  templatePath: './base-assets/templates',
};

export function hasCloudStorageSegment(value: string) {
  const normalized = value.toLowerCase().replace(/\\/g, '/');
  return (
    normalized.includes('onedrive') ||
    normalized.includes('google drive') ||
    normalized.includes('googledrive') ||
    normalized.includes('dropbox')
  );
}

export function validateManagedPathValue(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Path cannot be empty';
  }

  if (trimmed.includes('\0')) {
    return 'Path contains invalid characters';
  }

  if (!path.isAbsolute(trimmed)) {
    if (!trimmed.startsWith('./')) {
      return 'Relative paths must start with ./';
    }
    if (trimmed.split(/[\\/]+/).includes('..')) {
      return 'Relative paths cannot contain ..';
    }
  }

  if (/[<>:"|?*]/.test(trimmed.replace(/^[A-Za-z]:/, ''))) {
    return 'Path contains invalid characters';
  }

  return null;
}

export function resolveManagedPath(value: string) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(process.cwd(), value);
}

export function normalizeManagedPath(value: string) {
  return resolveManagedPath(value).toLowerCase();
}
