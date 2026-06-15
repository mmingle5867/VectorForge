import type { AssetProfileType } from '@/lib/package-structure';

export type AssetOutputRole =
  | 'main-mockup'
  | 'transparent-preview'
  | 'files-included'
  | 'license-use'
  | 'close-up-detail'
  | 'production-preview'
  | 'size-comparison'
  | 'material-example'
  | 'finished-product'
  | 'instruction-preview';

export interface AssetProfileDefinition {
  key: AssetProfileType;
  label: string;
  description: string;
  defaultFolder: AssetProfileType;
  supportedOutputRoles: AssetOutputRole[];
  defaultListingImageRoles: AssetOutputRole[];
  defaultCompositeRoles: AssetOutputRole[];
  notes?: string;
}

export const ASSET_PROFILE_DEFINITIONS: Record<AssetProfileType, AssetProfileDefinition> = {
  digital: {
    key: 'digital',
    label: 'Digital',
    description: 'Digital download files such as SVG, PNG, JPG, DXF, PDF, and EPS.',
    defaultFolder: 'digital',
    supportedOutputRoles: [
      'main-mockup',
      'transparent-preview',
      'files-included',
      'license-use',
      'close-up-detail',
    ],
    defaultListingImageRoles: ['main-mockup', 'transparent-preview', 'files-included'],
    defaultCompositeRoles: ['main-mockup', 'files-included', 'license-use'],
  },
  laser: {
    key: 'laser',
    label: 'Laser',
    description: 'Laser-ready product files, size variants, and production previews.',
    defaultFolder: 'laser',
    supportedOutputRoles: [
      'main-mockup',
      'size-comparison',
      'production-preview',
      'material-example',
      'finished-product',
    ],
    defaultListingImageRoles: ['main-mockup', 'size-comparison', 'material-example'],
    defaultCompositeRoles: ['main-mockup', 'size-comparison', 'production-preview'],
  },
  vinyl: {
    key: 'vinyl',
    label: 'Vinyl',
    description: 'Vinyl and decal cut files with color, transfer, and size previews.',
    defaultFolder: 'vinyl',
    supportedOutputRoles: [
      'main-mockup',
      'size-comparison',
      'production-preview',
      'material-example',
      'instruction-preview',
    ],
    defaultListingImageRoles: ['main-mockup', 'size-comparison', 'instruction-preview'],
    defaultCompositeRoles: ['main-mockup', 'size-comparison'],
  },
  cnc: {
    key: 'cnc',
    label: 'CNC',
    description: 'CNC-ready vector files with dimensions, material, and production previews.',
    defaultFolder: 'cnc',
    supportedOutputRoles: [
      'main-mockup',
      'production-preview',
      'material-example',
      'size-comparison',
    ],
    defaultListingImageRoles: ['main-mockup', 'production-preview', 'material-example'],
    defaultCompositeRoles: ['main-mockup', 'production-preview'],
  },
  sewing: {
    key: 'sewing',
    label: 'Sewing',
    description: 'Sewing and pattern products with printable files, instructions, and size variants.',
    defaultFolder: 'sewing',
    supportedOutputRoles: [
      'main-mockup',
      'files-included',
      'instruction-preview',
      'size-comparison',
    ],
    defaultListingImageRoles: ['main-mockup', 'files-included', 'instruction-preview'],
    defaultCompositeRoles: ['main-mockup', 'files-included'],
  },
  print: {
    key: 'print',
    label: 'Print',
    description: 'Print, sublimation, and printable profile files with mockups and size variants.',
    defaultFolder: 'print',
    supportedOutputRoles: [
      'main-mockup',
      'transparent-preview',
      'close-up-detail',
      'size-comparison',
      'finished-product',
    ],
    defaultListingImageRoles: ['main-mockup', 'close-up-detail', 'size-comparison'],
    defaultCompositeRoles: ['main-mockup', 'close-up-detail'],
  },
};

export function getAssetProfileDefinition(profileType: AssetProfileType) {
  return ASSET_PROFILE_DEFINITIONS[profileType];
}
