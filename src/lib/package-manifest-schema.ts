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
  ownerId?: string;
  workspaceId?: string;
}

export interface ExternalRefs {
  sourceJobId: string;
  listingToolProductId: string;
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
  re