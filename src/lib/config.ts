/**
 * Application configuration
 * Paths may be relative to the project root or absolute local filesystem paths.
 */

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  identity: {
    name: process.env.APP_NAME || 'local-asset-workbench',
    displayName: process.env.APP_DISPLAY_NAME || 'VectorForge',
    slug: process.env.APP_SLUG || 'local-asset-workbench',
    sourceId: process.env.APP_SOURCE_ID || 'local-asset-workbench',
    website: process.env.APP_WEBSITE || '',
    supportEmail: process.env.APP_SUPPORT_EMAIL || '',
  },

  localFirst: {
    localAuthEnabled: readBoolean(process.env.LOCAL_AUTH_ENABLED, false),
    localUserId: process.env.LOCAL_USER_ID || 'local-user',
    localUserEmail: process.env.LOCAL_USER_EMAIL || 'local@local-asset-workbench.local',
    localUserName: process.env.LOCAL_USER_NAME || 'Local User',
    localOwnerName: process.env.LOCAL_OWNER_NAME || 'Local Owner',
    localWorkspaceName: process.env.LOCAL_WORKSPACE_NAME || 'Default Workspace',
  },

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
    supportedFormats: ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/svg+xml'],
    maxFileSize: 50 * 1024 * 1024, // 50MB per file
    rasterExportWidth: parseInt(process.env.RASTER_EXPORT_WIDTH || '2000', 10),
    rasterExportHeight: parseInt(process.env.RASTER_EXPORT_HEIGHT || '2000', 10),
    svgRasterStrokeWidth: parseInt(process.env.SVG_RASTER_STROKE_WIDTH || '4', 10),
    pngExportArtworkColor: process.env.PNG_EXPORT_ARTWORK_COLOR || '#000000',
    pngWhiteTransparencyThreshold: parseInt(process.env.PNG_WHITE_TRANSPARENCY_THRESHOLD || '245', 10),
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
