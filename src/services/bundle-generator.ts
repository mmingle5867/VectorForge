import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import packageJson from '../../package.json';
import { logger } from '@/lib/logger';
import { resolveManagedPath } from '@/lib/path-management';
import { getArtworkPackageFolderName } from '@/lib/package-structure';
import type {
  AssetProfileEntry,
  BundleMember,
  PackageFileEntry,
  PackageManifestV2,
  ListingMetadata,
  ProductProfileEntry,
  ProductVariantEntry,
} from '@/lib/package-manifest-schema';
import type { PackageDocumentSettings } from '@/services/template-renderer';
import { generatePackageDocuments } from '@/services/template-renderer';
import type { BundlePlan } from '@/services/bundle-planner';
import { updateBundleMembershipMarkers } from '@/services/bundle-membership';

const BUNDLE_README_FALLBACK = `Thank you for your purchase.

Bundle:
{{BUNDLE_TITLE}}

Bundle ID:
{{BUNDLE_ID}}

Bundle SKU:
{{BUNDLE_SKU}}

Member Count:
{{BUNDLE_MEMBER_COUNT}}

Included Items:
{{BUNDLE_MEMBER_LIST}}

Included File Types:
{{BUNDLE_INCLUDED_FILE_TYPES}}

Support:
{{CONTACT_NAME}}
{{EMAIL}}
{{WEBSITE}}
{{SUPPORT_URL}}

Generated:
{{BUNDLE_CREATED_DATE}}
`;

const BUNDLE_LICENSE_FALLBACK = `License Type:
{{LICENSE_TYPE}}

Bundle ID:
{{BUNDLE_ID}}

Bundle:
{{BUNDLE_TITLE}}

Member Count:
{{BUNDLE_MEMBER_COUNT}}

For support contact:

{{CONTACT_NAME}}
{{EMAIL}}
{{WEBSITE}}
{{SUPPORT_URL}}

Generated:
{{BUNDLE_CREATED_DATE}}
`;

export type BundleGenerationInput = {
  plan: BundlePlan;
  bundleOutputPath: string;
  baseAssetsPath?: string;
  documentSettings?: PackageDocumentSettings;
};

export type BundleCopiedFile = {
  role: string;
  sourcePath: string;
  targetPath: string;
  bundlePath: string;
};

export type BundleGenerationResult = {
  success: boolean;
  bundleId: string;
  bundleFolderName: string;
  bundleFolderPath: string;
  manifestPath: string | null;
  readmePath: string | null;
  licensePath: string | null;
  zipPath: string | null;
  warnings: string[];
  errors: string[];
  copiedFiles: BundleCopiedFile[];
  manifest?: PackageManifestV2;
};

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function relPath(from: string, to: string) {
  return normalizeRelativePath(path.relative(from, to));
}

function toManifestRelativePath(manifestRoot: string, filePath: string) {
  return relPath(manifestRoot, filePath);
}

function isInsideRoot(root: string, filePath: string) {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileEntry(
  manifestRoot: string,
  absPath: string,
  role: string,
  metadata?: Partial<PackageFileEntry>
): Promise<PackageFileEntry> {
  const stats = await fs.stat(absPath);
  const format = path.extname(absPath).replace('.', '').toLowerCase() || 'unknown';

  return {
    role,
    path: toManifestRelativePath(manifestRoot, absPath),
    format,
    mimeType:
      metadata?.mimeType ||
      (format === 'svg'
        ? 'image/svg+xml'
        : format === 'png'
          ? 'image/png'
          : format === 'jpg' || format === 'jpeg'
            ? 'image/jpeg'
            : format === 'txt'
              ? 'text/plain'
              : format === 'json'
                ? 'application/json'
                : format === 'zip'
                  ? 'application/zip'
                  : 'application/octet-stream'),
    sizeBytes: stats.size,
    sha256: '',
    fingerprint: '',
    width: metadata?.width ?? null,
    height: metadata?.height ?? null,
    assetProfile: metadata?.assetProfile || '',
    templateId: metadata?.templateId || '',
    slot: metadata?.slot ?? null,
  };
}

function buildBundleMemberList(plan: BundlePlan) {
  return plan.members
    .map((member, index) => {
      const fileTypes = member.includedFiles.map((file) => file.format.toUpperCase()).join(', ');
      return `${index + 1}. ${member.productTitle} (${member.packageId})${fileTypes ? ` - ${fileTypes}` : ''}`;
    })
    .join('\n');
}

function buildBundleMemberTable(plan: BundlePlan) {
  return plan.members
    .map(
      (member, index) =>
        `${index + 1} | ${member.productTitle} | ${member.packageId} | ${member.artworkId} | ${member.profileId}`
    )
    .join('\n');
}

function getIncludedFileTypes(plan: BundlePlan) {
  return Array.from(
    new Set(
      plan.members.flatMap((member) => member.includedFiles.map((file) => file.format.toUpperCase()))
    )
  );
}

function buildBundleFileMappings(manifestRoot: string, plan: BundlePlan, copiedFiles: BundleCopiedFile[]) {
  const sourceEntries: PackageFileEntry[] = [];
  const artworkEntries: PackageFileEntry[] = [];

  for (const member of plan.members) {
    const sourceManifestPath = member.sourceManifestPath;
    const sourcePackagePath = member.sourcePackagePath;

    sourceEntries.push({
      role: 'source-manifest',
      path: toManifestRelativePath(manifestRoot, sourceManifestPath),
      format: 'json',
      mimeType: 'application/json',
      sizeBytes: 0,
      sha256: '',
      fingerprint: '',
      width: null,
      height: null,
      assetProfile: member.profileId,
      templateId: '',
      slot: null,
    });

    sourceEntries.push({
      role: 'source-package',
      path: toManifestRelativePath(manifestRoot, sourcePackagePath),
      format: 'folder',
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      sha256: '',
      fingerprint: '',
      width: null,
      height: null,
      assetProfile: member.profileId,
      templateId: '',
      slot: null,
    });

    for (const file of member.includedFiles) {
      const copied = copiedFiles.find((candidate) => candidate.sourcePath === file.sourcePath);
      if (!copied) continue;

      artworkEntries.push({
        role: file.role,
        path: toManifestRelativePath(manifestRoot, copied.targetPath),
        format: file.format,
        mimeType:
          file.format === 'svg'
            ? 'image/svg+xml'
            : file.format === 'png'
              ? 'image/png'
              : file.format === 'jpg' || file.format === 'jpeg'
                ? 'image/jpeg'
                : 'application/octet-stream',
        sizeBytes: file.sizeBytes || 0,
        sha256: '',
        fingerprint: '',
        width: null,
        height: null,
        assetProfile: member.profileId,
        templateId: '',
        slot: null,
      });
    }
  }

  return { sourceEntries, artworkEntries };
}

function buildAssetProfiles(plan: BundlePlan): AssetProfileEntry[] {
  return plan.members.map((member, index) => ({
    profileType: member.productProfile?.profileType || 'bundle-member',
    profileId: member.profileId,
    status: 'included',
    primarySku: member.sku,
    folder: member.bundleFolder || `member-${index + 1}`,
  }));
}

function buildProductProfiles(plan: BundlePlan): ProductProfileEntry[] {
  return plan.members.map((member, index) => ({
    profileType: member.productProfile?.profileType || 'bundle-member',
    profileId: member.profileId,
    status: 'included',
    primarySku: member.sku,
    folder: member.bundleFolder || `member-${index + 1}`,
    productProfileId: member.profileId,
  }));
}

function buildProductVariant(plan: BundlePlan): ProductVariantEntry {
  return {
    sku: plan.bundleId,
    profileType: 'bundle',
    variantType: 'bundle-package',
    options: {
      bundleTitle: plan.title,
      memberCount: plan.memberCount,
    },
    price: null,
    quantity: null,
  };
}

function buildBundleReadiness(plan: BundlePlan, zipGenerated: boolean) {
  const ready = plan.readiness.allMembersPresent && plan.readiness.allSourceManifestsReadable && plan.readiness.allFilesResolved && zipGenerated;

  return {
    artworkApproved: true,
    filesComplete: plan.readiness.allFilesResolved,
    listingCopyComplete: true,
    imagesComplete: false,
    downloadsComplete: zipGenerated,
    readyForListingTool: ready,
    allMembersPresent: plan.readiness.allMembersPresent,
    allSourceManifestsReadable: plan.readiness.allSourceManifestsReadable,
    allFilesResolved: plan.readiness.allFilesResolved,
    bundleZipGenerated: zipGenerated,
  };
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

function buildProcessingHistory(bundleId: string, plan: BundlePlan, bundleRoot: string, zipGenerated: boolean) {
  const now = new Date().toISOString();
  const settings = {
    bundleId,
    bundleTitle: plan.title,
    bundleFolderName: path.basename(bundleRoot),
    memberCount: plan.memberCount,
  };

  return [
    {
      step: 'bundle-created',
      app: 'VectorForge',
      appVersion: packageJson.version,
      timestamp: now,
      settings,
    },
    {
      step: 'bundle-members-resolved',
      app: 'VectorForge',
      appVersion: packageJson.version,
      timestamp: now,
      settings,
    },
    {
      step: 'bundle-documents-generated',
      app: 'VectorForge',
      appVersion: packageJson.version,
      timestamp: now,
      settings,
    },
    {
      step: 'bundle-zip-generated',
      app: 'VectorForge',
      appVersion: packageJson.version,
      timestamp: now,
      settings: { ...settings, zipGenerated },
    },
  ];
}

async function copyBundleFiles(
  plan: BundlePlan,
  bundleRoot: string,
  warnings: string[],
  errors: string[]
) {
  const copiedFiles: BundleCopiedFile[] = [];

  for (const member of plan.members) {
    const memberFolder = path.join(bundleRoot, 'members', member.bundleFolder);
    await fs.mkdir(memberFolder, { recursive: true });

    for (const file of member.includedFiles) {
      const sourcePath = path.resolve(file.sourcePath);
      const targetPath = path.join(memberFolder, path.basename(sourcePath));

      if (!isInsideRoot(bundleRoot, targetPath)) {
        errors.push(`Bundle target escapes bundle root: ${targetPath}`);
        continue;
      }

      if (!(await pathExists(sourcePath))) {
        errors.push(`Bundle source file is missing: ${sourcePath}`);
        continue;
      }

      const stats = await fs.stat(sourcePath);
      if (!stats.isFile()) {
        errors.push(`Bundle source is not a file: ${sourcePath}`);
        continue;
      }

      await fs.copyFile(sourcePath, targetPath);
      copiedFiles.push({
        role: file.role,
        sourcePath,
        targetPath,
        bundlePath: file.bundlePath,
      });
    }
  }

  if (warnings.length > 0) {
    logger.warn('Bundle generation warnings', { warnings });
  }

  return copiedFiles;
}

async function writeBundleManifest(manifestPath: string, manifest: PackageManifestV2) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

async function createBundleZip(
  bundleRoot: string,
  metadataDir: string,
  packageDir: string,
  zipName: string,
  copiedFiles: BundleCopiedFile[]
) {
  const zip = new JSZip();

  for (const file of copiedFiles) {
    const data = await fs.readFile(file.targetPath);
    const entryPath = normalizeRelativePath(file.bundlePath.replace(/^members\//, ''));
    zip.file(entryPath, data);
  }

  for (const fileName of ['README.txt', 'LICENSE.txt']) {
    const filePath = path.join(metadataDir, fileName);
    if (await pathExists(filePath)) {
      const data = await fs.readFile(filePath);
      zip.file(fileName, data);
    }
  }

  await fs.mkdir(packageDir, { recursive: true });
  const zipOutputPath = path.join(packageDir, zipName);
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  await fs.writeFile(zipOutputPath, buffer);
  return zipOutputPath;
}

export async function generateBundlePackage(input: BundleGenerationInput): Promise<BundleGenerationResult> {
  const warnings = [...input.plan.warnings];
  const errors = [...input.plan.errors];
  let createdBundleRoot = false;

  if (errors.length > 0) {
    return {
      success: false,
      bundleId: input.plan.bundleId,
      bundleFolderName: '',
      bundleFolderPath: '',
      manifestPath: null,
      readmePath: null,
      licensePath: null,
      zipPath: null,
      warnings,
      errors,
      copiedFiles: [],
    };
  }

  const outputRoot = resolveManagedPath(input.bundleOutputPath);
  const bundleFolderName = getArtworkPackageFolderName(input.plan.bundleId, input.plan.title);
  const bundleRoot = path.join(outputRoot, bundleFolderName);
  const internalDir = path.join(bundleRoot, '_internal');
  const metadataDir = path.join(bundleRoot, 'metadata');
  const packageDir = path.join(bundleRoot, 'package');
  const manifestPath = path.join(internalDir, 'manifest.json');
  const zipName = `${bundleFolderName}.zip`;
  const zipPath = path.join(packageDir, zipName);

  try {
    if (await pathExists(bundleRoot)) {
      throw new Error(`Bundle output folder already exists: ${bundleRoot}`);
    }

    await fs.mkdir(bundleRoot, { recursive: true });
    createdBundleRoot = true;
    await fs.mkdir(internalDir, { recursive: true });
    await fs.mkdir(metadataDir, { recursive: true });
    await fs.mkdir(packageDir, { recursive: true });

    const copiedFiles = await copyBundleFiles(input.plan, bundleRoot, warnings, errors);
    if (errors.length > 0) {
      throw new Error(errors[0]);
    }

    const memberTable = buildBundleMemberTable(input.plan);
    const bundleIncludedFileTypes = getIncludedFileTypes(input.plan);
    const templateRoot = resolveManagedPath(
      input.documentSettings?.templatePath ||
        path.join(resolveManagedPath(input.baseAssetsPath || './base-assets'), 'templates')
    );

    const documentSettings: PackageDocumentSettings = {
      ...(input.documentSettings || {}),
      templatePath: templateRoot,
    };

    const { readmePath, licensePath } = await generatePackageDocuments({
      outputDir: metadataDir,
      baseAssetsPath: resolveManagedPath(input.baseAssetsPath || './base-assets'),
      productName: input.plan.title,
      sku: input.plan.bundleId,
      fileTypes: bundleIncludedFileTypes,
      bundleId: input.plan.bundleId,
      bundleTitle: input.plan.title,
      bundleSku: input.plan.bundleId,
      bundleMemberCount: input.plan.memberCount,
      bundleMemberList: [buildBundleMemberList(input.plan)],
      bundleMemberTable: memberTable,
      bundleIncludedFileTypes,
      bundleCreatedAt: new Date().toISOString(),
      profileType: 'bundle',
      artworkTitle: input.plan.title,
      settings: documentSettings,
      templateFallbacks: {
        readme: BUNDLE_README_FALLBACK,
        license: BUNDLE_LICENSE_FALLBACK,
      },
    });

    const zipGeneratedPath = await createBundleZip(bundleRoot, metadataDir, packageDir, zipName, copiedFiles);

    const manifestRoot = internalDir;
    const { sourceEntries, artworkEntries } = buildBundleFileMappings(manifestRoot, input.plan, copiedFiles);
    const readmeAbsPath = path.join(metadataDir, 'README.txt');
    const licenseAbsPath = path.join(metadataDir, 'LICENSE.txt');
    const zipAbsPath = zipGeneratedPath;
    const readmeEntry = await fileEntry(manifestRoot, readmeAbsPath, 'readme');
    const licenseEntry = await fileEntry(manifestRoot, licenseAbsPath, 'license');
    const zipEntry = await fileEntry(manifestRoot, zipAbsPath, 'bundle-zip');

    const memberEntries: BundleMember[] = input.plan.members.map((member) => ({
      sortOrder: member.sortOrder,
      packageId: member.packageId,
      artworkId: member.artworkId,
      profileId: member.profileId,
      productTitle: member.productTitle,
      sourceManifestPath: toManifestRelativePath(manifestRoot, member.sourceManifestPath),
      sourcePackagePath: toManifestRelativePath(manifestRoot, member.sourcePackagePath),
      bundleFolder: member.bundleFolder,
      includedFiles: member.includedFiles.map((file) => ({
        role: file.role,
        sourcePath: toManifestRelativePath(manifestRoot, file.sourcePath),
        bundlePath: toManifestRelativePath(
          manifestRoot,
          path.join(bundleRoot, file.bundlePath)
        ),
        format: file.format,
        sizeBytes: file.sizeBytes,
      })),
    }));

    const manifest: PackageManifestV2 = {
      schemaVersion: '2.0',
      sourceApp: 'VectorForge',
      appVersion: packageJson.version,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      package: {
        packageId: input.plan.bundleId,
        packageType: 'bundle-package',
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
        artworkId: '',
        title: input.plan.title,
        slug: input.plan.slug,
        sourceFileName: '',
        sourceType: 'bundle',
        inputFormat: 'bundle',
      },
      assetProfiles: buildAssetProfiles(input.plan),
      productProfiles: buildProductProfiles(input.plan),
      productVariants: [buildProductVariant(input.plan)],
      files: {
        source: sourceEntries,
        artwork: artworkEntries,
        downloads: zipEntry ? [zipEntry] : [],
        listingImages: [],
        compositeImages: [],
        metadata: [readmeEntry, licenseEntry].filter((entry): entry is PackageFileEntry => Boolean(entry)),
        package: [],
      },
      listing: createEmptyListingMetadata(),
      bundle: {
        bundleId: input.plan.bundleId,
        title: input.plan.title,
        slug: input.plan.slug,
        sku: input.plan.bundleId,
        memberCount: input.plan.memberCount,
        missingFilePolicy: 'fail',
        zipPath: zipEntry?.path || `../package/${zipName}`,
      },
      members: memberEntries,
      rights: {
        ownership: '',
        commercialUseAllowed: null,
        resaleAllowed: null,
        licenseType: input.documentSettings?.defaultLicenseType || '',
        sourceNotes: '',
      },
      readiness: buildBundleReadiness(input.plan, true),
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
      processingHistory: buildProcessingHistory(input.plan.bundleId, input.plan, bundleRoot, true),
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

    await writeBundleManifest(manifestPath, manifest);

    const membershipUpdate = await updateBundleMembershipMarkers({
      bundleId: input.plan.bundleId,
      bundleTitle: input.plan.title,
      bundleManifestPath: manifestPath,
      members: input.plan.members.map((member) => ({
        sourceManifestPath: member.sourceManifestPath,
        sourcePackagePath: member.sourcePackagePath,
      })),
    });
    warnings.push(...membershipUpdate.warnings);

    return {
      success: true,
      bundleId: input.plan.bundleId,
      bundleFolderName,
      bundleFolderPath: bundleRoot,
      manifestPath,
      readmePath,
      licensePath,
      zipPath: zipGeneratedPath,
      warnings,
      errors: [],
      copiedFiles,
      manifest,
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));

    try {
      if (createdBundleRoot) {
        await fs.rm(bundleRoot, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup failures.
    }

    return {
      success: false,
      bundleId: input.plan.bundleId,
      bundleFolderName,
      bundleFolderPath: bundleRoot,
      manifestPath: null,
      readmePath: null,
      licensePath: null,
      zipPath: null,
      warnings,
      errors: [error instanceof Error ? error.message : String(error)],
      copiedFiles: [],
    };
  }
}

export default { generateBundlePackage };
