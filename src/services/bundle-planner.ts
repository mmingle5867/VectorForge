import fs from 'fs/promises';
import path from 'path';
import { isInternalPackagePath } from '@/lib/package-structure';
import type {
  BundleIncludedFile,
  BundleMember,
  PackageFileEntry,
  PackageManifestV2,
  ReadinessInfo,
} from '@/lib/package-manifest-schema';
import { issueNumber } from '@/services/numbering-service';

const SUPPORTED_CUSTOMER_FILE_ROLES = ['primary-svg', 'primary-png', 'primary-jpg'] as const;
const IGNORED_FILE_EXTENSIONS = new Set(['.zip']);

export type BundlePlannerInput = {
  bundleTitle: string;
  bundleId?: string;
  memberPackages: Array<{
    manifestPath: string;
  }>;
};

export type BundlePlanMember = BundleMember & {
  sku: string;
  readiness: ReadinessInfo | null;
  productProfile: PackageManifestV2['productProfiles'][number] | null;
};

export type BundlePlan = {
  bundleId: string;
  title: string;
  slug: string;
  sku: string;
  memberCount: number;
  members: BundlePlanMember[];
  readiness: {
    allMembersPresent: boolean;
    allSourceManifestsReadable: boolean;
    allFilesResolved: boolean;
  };
  warnings: string[];
  errors: string[];
};

type LoadedMember = {
  manifest: PackageManifestV2;
  manifestPath: string;
  packageRoot: string;
  sourcePackagePath: string;
  packageId: string;
  artworkId: string;
  profileId: string;
  sku: string;
  productTitle: string;
  productProfile: PackageManifestV2['productProfiles'][number] | null;
  readiness: ReadinessInfo | null;
  includedFiles: BundleIncludedFile[];
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitizeBundleFolderName(value: string) {
  const words = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  const folderName = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join('');

  return (folderName || 'Untitled').slice(0, 120);
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveInputPath(inputPath: string) {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(process.cwd(), inputPath);
}

function getPackageRootFromManifestPath(manifestPath: string) {
  const manifestDir = path.dirname(manifestPath);
  return path.basename(manifestDir).toLowerCase() === '_internal'
    ? path.dirname(manifestDir)
    : manifestDir;
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
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

function getPrimaryProfile(manifest: PackageManifestV2) {
  return manifest.productProfiles?.[0] || null;
}

function getPrimarySku(manifest: PackageManifestV2) {
  return (
    readString(manifest.productVariants?.[0]?.sku) ||
    readString(manifest.productProfiles?.[0]?.primarySku) ||
    readString(manifest.assetProfiles?.[0]?.primarySku)
  );
}

function getProfileId(manifest: PackageManifestV2) {
  return (
    readString(manifest.productProfiles?.[0]?.productProfileId) ||
    readString(manifest.productProfiles?.[0]?.profileId) ||
    readString(manifest.assetProfiles?.[0]?.profileId)
  );
}

function shouldIncludeFile(entry: PackageFileEntry) {
  if (!SUPPORTED_CUSTOMER_FILE_ROLES.includes(entry.role as (typeof SUPPORTED_CUSTOMER_FILE_ROLES)[number])) {
    return false;
  }

  if (isInternalPackagePath(entry.path)) {
    return false;
  }

  return !IGNORED_FILE_EXTENSIONS.has(path.extname(entry.path).toLowerCase());
}

async function resolveIncludedFiles(input: {
  manifest: PackageManifestV2;
  packageRoot: string;
  bundleFolder: string;
  errors: string[];
}) {
  const filesByRole = new Map<string, PackageFileEntry>();

  for (const entry of input.manifest.files?.artwork || []) {
    if (shouldIncludeFile(entry)) {
      filesByRole.set(entry.role, entry);
    }
  }

  const includedFiles: BundleIncludedFile[] = [];

  for (const role of SUPPORTED_CUSTOMER_FILE_ROLES) {
    const entry = filesByRole.get(role);

    if (!entry) {
      input.errors.push(`Required customer-facing file is missing from manifest: ${role}`);
      continue;
    }

    const normalizedEntryPath = normalizeRelativePath(entry.path);
    const sourcePath = path.resolve(input.packageRoot, normalizedEntryPath);
    const relativeCheck = path.relative(input.packageRoot, sourcePath);

    if (!relativeCheck || relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
      input.errors.push(`Customer-facing file resolves outside package folder: ${entry.path}`);
      continue;
    }

    if (!(await pathExists(sourcePath))) {
      input.errors.push(`Customer-facing file is missing on disk: ${sourcePath}`);
      continue;
    }

    const stats = await fs.stat(sourcePath);
    if (!stats.isFile()) {
      input.errors.push(`Customer-facing file is not a file: ${sourcePath}`);
      continue;
    }

    includedFiles.push({
      role,
      sourcePath,
      bundlePath: normalizeRelativePath(path.join('members', input.bundleFolder, path.basename(entry.path))),
      format: entry.format || path.extname(sourcePath).replace('.', '').toLowerCase() || 'unknown',
      sizeBytes: stats.size,
    });
  }

  return includedFiles;
}

function buildBundleFolders(members: Array<{ productTitle: string; artworkId: string; packageId: string }>) {
  const baseNames = members.map((member) => sanitizeBundleFolderName(member.productTitle));
  const counts = new Map<string, number>();

  for (const baseName of baseNames) {
    counts.set(baseName, (counts.get(baseName) || 0) + 1);
  }

  return members.map((member, index) => {
    const baseName = baseNames[index];
    if ((counts.get(baseName) || 0) <= 1) {
      return baseName;
    }

    const identitySuffix = readString(member.artworkId) || readString(member.packageId) || String(index + 1);
    return `${baseName}_${identitySuffix.replace(/[^a-zA-Z0-9_-]+/g, '')}`;
  });
}

function collectReadinessWarnings(manifest: PackageManifestV2, packageId: string) {
  const warnings: string[] = [];
  const readiness = manifest.readiness;

  if (!readiness) {
    return [`Package ${packageId} has no readiness section`];
  }

  for (const [key, value] of Object.entries(readiness)) {
    if (value === false) {
      warnings.push(`Package ${packageId} readiness flag is false: ${key}`);
    }
  }

  return warnings;
}

async function loadAndValidateMember(input: {
  manifestPath: string;
  bundleFolder: string;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifestPath = resolveInputPath(input.manifestPath);

  if (!(await pathExists(manifestPath))) {
    return {
      member: null,
      warnings,
      errors: [`Source manifest is missing: ${manifestPath}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = await readManifest(manifestPath);
  } catch (error) {
    return {
      member: null,
      warnings,
      errors: [
        `Source manifest could not be read: ${manifestPath} (${error instanceof Error ? error.message : String(error)})`,
      ],
    };
  }

  if (!isPackageManifest(parsed)) {
    return {
      member: null,
      warnings,
      errors: [`Source manifest is not a supported Manifest V2 file: ${manifestPath}`],
    };
  }

  const manifest = parsed;
  const packageRoot = getPackageRootFromManifestPath(manifestPath);

  if (!(await pathExists(packageRoot))) {
    errors.push(`Source package folder is missing: ${packageRoot}`);
  }

  if (manifest.package.packageType === 'bundle-package') {
    errors.push(`Bundle packages cannot be used as bundle members: ${manifest.package.packageId}`);
  }

  const packageId = readString(manifest.package.packageId);
  const artworkId = readString(manifest.artwork?.artworkId);
  const profileId = getProfileId(manifest);
  const sku = getPrimarySku(manifest);
  const productTitle = readString(manifest.listing?.title) || readString(manifest.artwork?.title);

  if (!packageId) errors.push(`Source manifest is missing package.packageId: ${manifestPath}`);
  if (!artworkId) errors.push(`Source manifest is missing artwork.artworkId: ${manifestPath}`);
  if (!profileId) errors.push(`Source manifest is missing product/profile ID: ${manifestPath}`);
  if (!productTitle) errors.push(`Source manifest is missing product title: ${manifestPath}`);

  const includedFiles = await resolveIncludedFiles({
    manifest,
    packageRoot,
    bundleFolder: input.bundleFolder,
    errors,
  });

  warnings.push(...collectReadinessWarnings(manifest, packageId || manifestPath));

  const member: LoadedMember | null = packageId
    ? {
        manifest,
        manifestPath,
        packageRoot,
        sourcePackagePath: packageRoot,
        packageId,
        artworkId,
        profileId,
        sku,
        productTitle,
        productProfile: getPrimaryProfile(manifest),
        readiness: manifest.readiness || null,
        includedFiles,
      }
    : null;

  return { member, warnings, errors };
}

function assertValidBundleInput(input: BundlePlannerInput) {
  const errors: string[] = [];

  if (!readString(input.bundleTitle)) {
    errors.push('Bundle title is required');
  }

  if (!Array.isArray(input.memberPackages) || input.memberPackages.length === 0) {
    errors.push('At least one member package is required');
  }

  input.memberPackages?.forEach((member, index) => {
    if (!readString(member.manifestPath)) {
      errors.push(`Member package ${index + 1} is missing manifestPath`);
    }
  });

  return errors;
}

export async function createBundlePlan(input: BundlePlannerInput): Promise<BundlePlan> {
  const title = readString(input.bundleTitle);
  const slug = slugify(title);
  const inputErrors = assertValidBundleInput(input);

  if (inputErrors.length > 0) {
    return {
      bundleId: readString(input.bundleId),
      title,
      slug,
      sku: readString(input.bundleId),
      memberCount: 0,
      members: [],
      readiness: {
        allMembersPresent: false,
        allSourceManifestsReadable: false,
        allFilesResolved: false,
      },
      warnings: [],
      errors: inputErrors,
    };
  }

  const provisionalMembers = input.memberPackages.map((member) => ({
    productTitle: path.basename(path.dirname(resolveInputPath(member.manifestPath))),
    artworkId: '',
    packageId: '',
  }));
  const provisionalFolders = buildBundleFolders(provisionalMembers);
  const loadedResults = await Promise.all(
    input.memberPackages.map((member, index) =>
      loadAndValidateMember({
        manifestPath: member.manifestPath,
        bundleFolder: provisionalFolders[index],
      })
    )
  );
  const warnings = loadedResults.flatMap((result) => result.warnings);
  const errors = loadedResults.flatMap((result) => result.errors);
  const loadedMembers = loadedResults
    .map((result) => result.member)
    .filter((member): member is LoadedMember => Boolean(member));

  const packageIdCounts = new Map<string, number>();
  for (const member of loadedMembers) {
    packageIdCounts.set(member.packageId, (packageIdCounts.get(member.packageId) || 0) + 1);
  }

  for (const [packageId, count] of packageIdCounts.entries()) {
    if (count > 1) {
      errors.push(`Duplicate package ID in bundle members: ${packageId}`);
    }
  }

  const finalFolders = buildBundleFolders(
    loadedMembers.map((member) => ({
      productTitle: member.productTitle,
      artworkId: member.artworkId,
      packageId: member.packageId,
    }))
  );

  const allMembersPresent = loadedMembers.length === input.memberPackages.length;
  const allSourceManifestsReadable = loadedResults.every((result) => Boolean(result.member));
  const allFilesResolved =
    errors.length === 0 &&
    loadedMembers.every((member) => member.includedFiles.length === SUPPORTED_CUSTOMER_FILE_ROLES.length);

  if (errors.length > 0) {
    return {
      bundleId: readString(input.bundleId),
      title,
      slug,
      sku: readString(input.bundleId),
      memberCount: loadedMembers.length,
      members: [],
      readiness: {
        allMembersPresent,
        allSourceManifestsReadable,
        allFilesResolved,
      },
      warnings,
      errors,
    };
  }

  const issuedBundleId = readString(input.bundleId) || (await issueNumber('bundle')).issuedNumber;
  const members: BundlePlanMember[] = loadedMembers.map((member, index) => {
    const bundleFolder = finalFolders[index];

    return {
      sortOrder: index + 1,
      packageId: member.packageId,
      artworkId: member.artworkId,
      profileId: member.profileId,
      productTitle: member.productTitle,
      sourceManifestPath: member.manifestPath,
      sourcePackagePath: member.sourcePackagePath,
      bundleFolder,
      includedFiles: member.includedFiles.map((file) => ({
        ...file,
        bundlePath: normalizeRelativePath(path.join('members', bundleFolder, path.basename(file.bundlePath))),
      })),
      sku: member.sku,
      readiness: member.readiness,
      productProfile: member.productProfile,
    };
  });

  return {
    bundleId: issuedBundleId,
    title,
    slug,
    sku: issuedBundleId,
    memberCount: members.length,
    members,
    readiness: {
      allMembersPresent: true,
      allSourceManifestsReadable: true,
      allFilesResolved: true,
    },
    warnings,
    errors: [],
  };
}

export default { createBundlePlan };
