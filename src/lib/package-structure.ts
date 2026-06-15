import path from 'path';

export const ASSET_PROFILE_TYPES = [
  'digital',
  'laser',
  'vinyl',
  'cnc',
  'sewing',
  'print',
] as const;

export type AssetProfileType = (typeof ASSET_PROFILE_TYPES)[number];

export const MARKETPLACE_KEYS = [
  'etsy',
  'shopify',
  'bigcommerce',
  'ebay',
  'custom',
] as const;

export type MarketplaceKey = (typeof MARKETPLACE_KEYS)[number] | string;

export const PROFILE_PACKAGE_PREFIXES: Record<AssetProfileType, string> = {
  digital: 'DIGI',
  laser: 'LASR',
  vinyl: 'VNYL',
  cnc: 'CNC',
  sewing: 'SEW',
  print: 'PRNT',
};

export const PROFILE_SUBFOLDERS = [
  'downloads',
  'production-files',
  'listing-images',
  'composite-images',
  'metadata',
  'package',
  'variants',
] as const;

export type ProfileSubfolder = (typeof PROFILE_SUBFOLDERS)[number];

function sanitizePathSegment(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '')
    .replace(/_+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120);
}

function sanitizePackageTitle(value: string) {
  const words = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  const title = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join('');

  return (title || 'Untitled').slice(0, 120);
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function getPackageBaseName(packageRoot: string) {
  return path.basename(path.normalize(packageRoot));
}

function getArtworkNumericSequence(packageRoot: string) {
  const match = getPackageBaseName(packageRoot).match(/^ART-(\d+)/i);
  return match?.[1] || '';
}

function assertAssetProfileType(profileType: string): asserts profileType is AssetProfileType {
  if (!ASSET_PROFILE_TYPES.includes(profileType as AssetProfileType)) {
    throw new Error(`Unsupported asset profile type: ${profileType}`);
  }
}

export function getArtworkPackageFolderName(
  artworkNumber: string | null | undefined,
  titleOrSlug: string | null | undefined
) {
  const safeArtworkNumber = sanitizePathSegment(artworkNumber || '');
  const safeTitle = sanitizePackageTitle(titleOrSlug || 'Untitled');

  return safeArtworkNumber ? `${safeArtworkNumber}_${safeTitle}` : safeTitle;
}

export function getV2PackageDirs(packageRoot: string) {
  return {
    internalDir: path.join(packageRoot, '_internal'),
    artworkDir: path.join(packageRoot, 'artwork'),
    digitalDir: path.join(packageRoot, 'digital'),
    laserDir: path.join(packageRoot, 'laser'),
    vinylDir: path.join(packageRoot, 'vinyl'),
    cncDir: path.join(packageRoot, 'cnc'),
    sewingDir: path.join(packageRoot, 'sewing'),
    printDir: path.join(packageRoot, 'print'),
    marketplaceDir: path.join(packageRoot, 'marketplace'),
    metadataDir: path.join(packageRoot, 'metadata'),
  };
}

export function getProfileDir(packageRoot: string, profileType: AssetProfileType) {
  assertAssetProfileType(profileType);
  return path.join(packageRoot, profileType);
}

export function getProfileSubfolderPath(
  packageRoot: string,
  profileType: AssetProfileType,
  subfolder: ProfileSubfolder
) {
  return path.join(getProfileDir(packageRoot, profileType), subfolder);
}

export function getProfileDownloadsDir(packageRoot: string, profileType: AssetProfileType) {
  return getProfileSubfolderPath(packageRoot, profileType, 'downloads');
}

export function getProfileProductionFilesDir(packageRoot: string, profileType: AssetProfileType) {
  return getProfileSubfolderPath(packageRoot, profileType, 'production-files');
}

export function getProfileListingImagesDir(packageRoot: string, profileType: AssetProfileType) {
  return getProfileSubfolderPath(packageRoot, profileType, 'listing-images');
}

export function getProfileCompositeImagesDir(packageRoot: string, profileType: AssetProfileType) {
  return getProfileSubfolderPath(packageRoot, profileType, 'composite-images');
}

export function getProfileMetadataDir(packageRoot: string, profileType: AssetProfileType) {
  return getProfileSubfolderPath(packageRoot, profileType, 'metadata');
}

export function getProfilePackageDir(packageRoot: string, profileType: AssetProfileType) {
  return getProfileSubfolderPath(packageRoot, profileType, 'package');
}

export function getProfileVariantsDir(packageRoot: string, profileType: AssetProfileType) {
  return getProfileSubfolderPath(packageRoot, profileType, 'variants');
}

export function getInternalManifestPath(packageRoot: string) {
  return path.join(getV2PackageDirs(packageRoot).internalDir, 'manifest.json');
}

export function getProcessingHistoryPath(packageRoot: string) {
  return path.join(getV2PackageDirs(packageRoot).internalDir, 'processing-history.json');
}

export function getAiMetadataPath(packageRoot: string) {
  return path.join(getV2PackageDirs(packageRoot).internalDir, 'ai-metadata.json');
}

export function getReadmePath(packageRoot: string) {
  return path.join(getV2PackageDirs(packageRoot).metadataDir, 'README.txt');
}

export function getLicensePath(packageRoot: string) {
  return path.join(getV2PackageDirs(packageRoot).metadataDir, 'LICENSE.txt');
}

export function getCustomerZipPath(packageRoot: string, profileType: AssetProfileType) {
  assertAssetProfileType(profileType);
  const prefix = PROFILE_PACKAGE_PREFIXES[profileType];
  const numericSequence = getArtworkNumericSequence(packageRoot);
  const zipName = numericSequence ? `${prefix}-${numericSequence}.zip` : `${prefix}.zip`;

  return path.join(getProfilePackageDir(packageRoot, profileType), zipName);
}

export function getMarketplaceDir(packageRoot: string, marketplaceKey: MarketplaceKey) {
  const safeMarketplaceKey = sanitizePathSegment(marketplaceKey).toLowerCase() || 'custom';
  return path.join(getV2PackageDirs(packageRoot).marketplaceDir, safeMarketplaceKey);
}

export function isInternalPackagePath(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  const rootFileName = normalized.split('/')[0];

  return (
    normalized === '_internal' ||
    normalized.startsWith('_internal/') ||
    rootFileName === 'manifest.json' ||
    rootFileName === 'processing-history.json' ||
    rootFileName === 'ai-metadata.json'
  );
}

/**
 * Examples for the future V2 structure:
 *
 * getArtworkPackageFolderName('ART-000125', 'Willey E Coyote')
 * -> ART-000125_WilleyECoyote
 *
 * getInternalManifestPath('ART-000125_WilleyECoyote')
 * -> ART-000125_WilleyECoyote/_internal/manifest.json
 *
 * getCustomerZipPath('ART-000125_WilleyECoyote', 'digital')
 * -> ART-000125_WilleyECoyote/digital/package/DIGI-000125.zip
 *
 * isInternalPackagePath('_internal/manifest.json')
 * -> true
 *
 * isInternalPackagePath('digital/downloads/ART-000125.svg')
 * -> false
 */
