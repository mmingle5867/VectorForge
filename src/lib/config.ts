/**
 * VectorForge Configuration
 * All paths are relative. Never use absolute paths.
 */

export const config = {
  // File paths (relative)
  paths: {
    uploads: process.env.UPLOAD_DIR || './uploads',
    output: process.env.OUTPUT_DIR || './output',
    baseAssets: process.env.BASE_ASSETS_DIR || './base-assets',
    logs: process.env.LOGS_DIR || './logs',
  },

  // Processing defaults
  processing: {
    defaultUpscaleFactor: parseInt(process.env.DEFAULT_UPSCALE_FACTOR || '2', 10),
    smartUpscaleThreshold: parseInt(process.env.SMART_UPSCALE_THRESHOLD || '2000', 10),
    maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '50', 10),
    supportedFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/tiff'],
    maxFileSize: 50 * 1024 * 1024, // 50MB per file
    rasterExportWidth: parseInt(process.env.RASTER_EXPORT_WIDTH || '2000', 10),
    rasterExportHeight: parseInt(process.env.RASTER_EXPORT_HEIGHT || '2000', 10),
  },

  // SKU format
  sku: {
    prefix: 'DIGI',
    separator: '-',
    padLength: 3, // 001, 002, etc.
  },

  // Output formats
  formats: {
    svg: true, // Primary - always generated
    ai: true, // Attempt generation
    dxf: true, // Attempt generation
    eps: true, // Attempt generation
    preview: true, // Thumbnail preview
  },

  // Clerk URLs
  clerk: {
    signInUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/sign-in',
    signUpUrl: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || '/sign-up',
    afterSignInUrl: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL || '/dashboard',
    afterSignUpUrl: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL || '/dashboard',
  },
} as const;

export type Config = typeof config;
export default config;
