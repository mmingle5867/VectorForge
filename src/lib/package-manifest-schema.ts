export type PackageManifestSchemaVersion = '2.0';
export type PackageStatus = 'draft' | 'generated' | 'failed' | 'archived';
export type PackageType =
  | 'digital-product-package'
  | 'artwork-product-package'
  | 'marketplace-export-package'
  | 'bundle-package'
  | 'internal-archive-package';

export interface PackageIdentity {
  packageId: string;
  packageType: PackageType | string;
  packageStatus: PackageStatus | string;
}

export interface PackageOwner {
  companyId: string;
  brandId: string;
  createdByUserId: string;
}

export interface ExternalRefs {
  vectorForgeJobId: string;
  listingToolProductId: string;
  etsyListingId: string;
  shopifyProductId: string;
  bigCommerceProductId: string;
}

export interface RightsInfo {
  ownership: string;
  commercialUseAllowed: boolean | null;
  resaleAllowed: boolean | null;
  licenseType: string;
  sourceNotes: string;
}

export interface ReadinessInfo {
  artworkApproved: boolean;
  filesComplete: boolean;
  listingCopyComplete: boolean;
  imagesComplete: boolean;
  downloadsComplete: boolean;
  readyForListingTool: boolean;
  allMembersPresent?: boolean;
  allSourceManifestsReadable?: boolean;
  allFilesResolved?: boolean;
  bundleZipGenerated?: boolean;
}

export interface ProcessingHistoryEntry {
  step: string;
  app: string;
  appVersion: string;
  timestamp: string;
  settings: Record<string, unknown>;
}

export interface PackageFileEntry {
  role: string;
  path: string;
  format: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  fingerprint?: string;
  width?: number | null;
  height?: number | null;
  assetProfile?: string;
  marketplace?: string;
  templateId?: string;
  slot?: number | null;
}

export interface AssetProfileEntry {
  profileType: string;
  profileId: string;
  status: string;
  primarySku: string;
  folder: string;
}

export interface ProductProfileEntry extends AssetProfileEntry {
  productProfileId: string;
}

export interface ProductVariantEntry {
  sku: string;
  profileType: string;
  variantType: string;
  options: Record<string, unknown>;
  price: number | null;
  quantity: number | null;
}

export interface AiMetadata {
  status: string;
  generatedAt: string | null;
  model: string | null;
  source: string;
  baseTitle: string;
  shortTitle: string;
  slug: string;
  summary: string;
  subjects: string[];
  themes: string[];
  styles: string[];
  occasions: string[];
  audiences: string[];
  keywords: string[];
  suggestedCategories: string[];
  notes: string;
}

export interface MarketplaceManifestEntry {
  ready: boolean;
  profileId: string;
  maxImages: number;
  maxVideos: number;
  requiredImages: number;
  requiredDigitalFiles: number;
  validationErrors: string[];
  images: string[];
  videos: string[];
  digitalFiles: string[];
}

export type BundleMissingFilePolicy = 'fail' | 'warn' | 'skip';
export type BundleMembershipStatus = 'active' | 'removed' | 'retired';

export interface BundleManifestSection {
  bundleId: string;
  title: string;
  slug: string;
  sku: string;
  memberCount: number;
  missingFilePolicy: BundleMissingFilePolicy | string;
  zipPath: string;
}

export interface BundleIncludedFile {
  role: string;
  sourcePath: string;
  bundlePath: string;
  format: string;
  sizeBytes?: number;
}

export interface BundleMember {
  sortOrder: number;
  packageId: string;
  artworkId: string;
  profileId: string;
  productTitle: string;
  sourceManifestPath: string;
  sourcePackagePath: string;
  bundleFolder: string;
  includedFiles: BundleIncludedFile[];
}

export interface BundleMembershipMarker {
  bundleId: string;
  bundleTitle: string;
  bundleManifestPath: string;
  status: BundleMembershipStatus | string;
  addedAt: string;
}

export interface Extensions {
  listingTool: Record<string, unknown>;
  analytics: Record<string, unknown>;
  accounting: Record<string, unknown>;
  marketplaceSync: Record<string, unknown>;
}

export interface PackageManifestV2 {
  schemaVersion: PackageManifestSchemaVersion;
  sourceApp: string;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  package: PackageIdentity;
  owner: PackageOwner;
  externalRefs: ExternalRefs;
  artwork: {
    artworkId: string;
    title: string;
    slug: string;
    sourceFileName: string;
    sourceType: string;
    inputFormat: string;
  };
  assetProfiles: AssetProfileEntry[];
  productProfiles: ProductProfileEntry[];
  productVariants: ProductVariantEntry[];
  files: {
    source: PackageFileEntry[];
    artwork: PackageFileEntry[];
    downloads: PackageFileEntry[];
    listingImages: PackageFileEntry[];
    compositeImages: PackageFileEntry[];
    metadata: PackageFileEntry[];
    package: PackageFileEntry[];
  };
  listing: {
    title: string;
    descriptionFile: string;
    tags: string[];
    materials: string[];
    category: string;
    isDigital: boolean;
  };
  marketplaces: Record<string, MarketplaceManifestEntry>;
  bundle?: BundleManifestSection;
  members?: BundleMember[];
  bundleMembership?: BundleMembershipMarker[];
  rights: RightsInfo;
  readiness: ReadinessInfo;
  aiMetadata: AiMetadata;
  processingHistory: ProcessingHistoryEntry[];
  extensions: Extensions;
  generation: {
    status: string;
    workflowStatus: string;
    generatedBy: string;
    notes: string[];
  };
}
