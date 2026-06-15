export type MarketplaceProfileKey = 'etsy' | 'shopify' | 'bigcommerce' | 'ebay' | 'custom';
export type MarketplaceImageFormat = 'jpg' | 'png' | 'webp';
export type MarketplaceVideoFormat = 'mp4' | 'mov';

export interface MarketplaceImageSize {
  width: number;
  height: number;
}

export interface MarketplaceProfileDefinition {
  key: MarketplaceProfileKey;
  label: string;
  maxImages: number;
  maxVideos: number;
  preferredImageSize: MarketplaceImageSize;
  allowedImageFormats: MarketplaceImageFormat[];
  allowedVideoFormats: MarketplaceVideoFormat[];
  squarePreferred: boolean;
  mainImageRules: string[];
  notes?: string;
}

export const MARKETPLACE_PROFILE_DEFINITIONS: Record<
  MarketplaceProfileKey,
  MarketplaceProfileDefinition
> = {
  etsy: {
    key: 'etsy',
    label: 'Etsy',
    maxImages: 20,
    maxVideos: 2,
    preferredImageSize: { width: 2000, height: 2000 },
    allowedImageFormats: ['jpg', 'png'],
    allowedVideoFormats: ['mp4'],
    squarePreferred: true,
    mainImageRules: [
      'Use a clear main image that accurately represents the product.',
      'Avoid excessive text in the first image when possible.',
    ],
    notes: 'Defaults are intentionally configurable later as marketplace requirements change.',
  },
  shopify: {
    key: 'shopify',
    label: 'Shopify',
    maxImages: 250,
    maxVideos: 10,
    preferredImageSize: { width: 2048, height: 2048 },
    allowedImageFormats: ['jpg', 'png', 'webp'],
    allowedVideoFormats: ['mp4', 'mov'],
    squarePreferred: true,
    mainImageRules: ['Use a clean product image suitable for product grids.'],
    notes: 'Placeholder defaults for future configurable store-specific profiles.',
  },
  bigcommerce: {
    key: 'bigcommerce',
    label: 'BigCommerce',
    maxImages: 100,
    maxVideos: 10,
    preferredImageSize: { width: 1280, height: 1280 },
    allowedImageFormats: ['jpg', 'png'],
    allowedVideoFormats: ['mp4'],
    squarePreferred: true,
    mainImageRules: ['Use the primary product image as slot 1.'],
    notes: 'Placeholder defaults for future configurable store-specific profiles.',
  },
  ebay: {
    key: 'ebay',
    label: 'eBay',
    maxImages: 24,
    maxVideos: 1,
    preferredImageSize: { width: 1600, height: 1600 },
    allowedImageFormats: ['jpg', 'png'],
    allowedVideoFormats: ['mp4'],
    squarePreferred: false,
    mainImageRules: ['Use a product-focused main image with minimal overlays.'],
    notes: 'Placeholder defaults; category rules may need specialization later.',
  },
  custom: {
    key: 'custom',
    label: 'Custom',
    maxImages: 20,
    maxVideos: 2,
    preferredImageSize: { width: 2000, height: 2000 },
    allowedImageFormats: ['jpg', 'png'],
    allowedVideoFormats: ['mp4'],
    squarePreferred: true,
    mainImageRules: ['User-defined marketplace or listing workflow.'],
  },
};

export function getMarketplaceProfileDefinition(marketplaceKey: MarketplaceProfileKey) {
  return MARKETPLACE_PROFILE_DEFINITIONS[marketplaceKey];
}
