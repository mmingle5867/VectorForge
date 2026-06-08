/**
 * VectorForge - TypeScript Type Definitions
 * Central type definitions used across the application.
 */

// =============================================================================
// Batch & Item Types
// =============================================================================

export type BatchStatusType =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type BatchItemStatusType =
  | 'PENDING'
  | 'UPSCALING'
  | 'CONVERTING'
  | 'GENERATING_FILES'
  | 'ZIPPING'
  | 'COMPLETED'
  | 'FAILED';

export interface BatchProgress {
  batchId: string;
  status: BatchStatusType;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  currentItemId: string | null;
  currentItemName: string | null;
  currentItemStatus: BatchItemStatusType | null;
  percentComplete: number;
  startedAt: string | null;
  estimatedTimeRemaining: number | null; // seconds
}

export interface BatchItemProgress {
  itemId: string;
  baseName: string;
  status: BatchItemStatusType;
  errorMsg: string | null;
}

// =============================================================================
// Upload Types
// =============================================================================

export interface UploadedFile {
  id: string;
  filename: string;
  originalFilename: string;
  baseName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  uploadPath: string;
  previewUrl: string;
}

export interface UploadResponse {
  success: boolean;
  files: UploadedFile[];
  errors: UploadError[];
}

export interface UploadError {
  filename: string;
  error: string;
}

// =============================================================================
// Settings Types
// =============================================================================

export interface UserSettingsData {
  defaultUpscaleFactor: 1 | 2 | 4;
  smartUpscaleThreshold: number;
  baseAssetsPath: string;
  outputPath: string;
  defaultSubstitutions: Record<string, string>;
  // Marketplace Preview settings
  enableMarketplacePreview: boolean;
  enableColorTint: boolean;
  tintColor: string;
  watermarkOpacity: number;
  backgroundFilename: string;
  watermarkFilename: string;
  // CNC / Vinyl / Laser mode
  cncMode: boolean; // true = monochrome trace-only (default), false = full color
}

// =============================================================================
// Marketplace Preview Types
// =============================================================================

export interface MarketplacePreviewSettings {
  enableMarketplacePreview: boolean;
  enableColorTint: boolean;
  tintColor: string;
  tintOpacity: number;
  watermarkOpacity: number;
  backgroundFilename: string;
  watermarkFilename: string;
}

// =============================================================================
// Substitution Types
// =============================================================================

export interface SubstitutionVariable {
  key: string;
  value: string;
}

export interface SubstitutionData {
  [key: string]: string;
}

// =============================================================================
// Processing Types
// =============================================================================

export interface ProcessingResult {
  success: boolean;
  itemId: string;
  baseName: string;
  sku: string;
  outputFolderPath: string;
  zipPath: string;
  files: GeneratedFile[];
  errors: string[];
  warnings: string[];
  processingTime: number; // milliseconds
}

export interface GeneratedFile {
  type: FileType;
  filename: string;
  path: string;
  size: number;
}

export type FileType =
  | 'original'
  | 'upscaled'
  | 'svg'
  | 'ai'
  | 'dxf'
  | 'eps'
  | 'preview'
  | 'sku_file'
  | 'metadata'
  | 'processing_log'
  | 'base_asset';

// =============================================================================
// Conversion Types
// =============================================================================

export interface ConversionOptions {
  colorMode: 'color' | 'binary';
  hierarchical: 'stacked' | 'cutout';
  filterSpeckle: number; // 0-128, default 4
  colorPrecision: number; // 1-8, default 6
  layerDifference: number; // 0-128, default 16
  cornerThreshold: number; // 0-180, default 60
  lengthThreshold: number; // 3.5-10, default 4.0
  maxIterations: number; // 1-20, default 10
  spliceThreshold: number; // 0-180, default 45
  pathPrecision: number; // decimal places, default 2
}

export const DEFAULT_CONVERSION_OPTIONS: ConversionOptions = {
  colorMode: 'binary',
  hierarchical: 'stacked',
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  cornerThreshold: 60,
  lengthThreshold: 4.0,
  maxIterations: 10,
  spliceThreshold: 45,
  pathPrecision: 2,
};

/** Full color mode conversion options (when CNC mode is disabled) */
export const FULL_COLOR_CONVERSION_OPTIONS: ConversionOptions = {
  colorMode: 'color',
  hierarchical: 'stacked',
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  cornerThreshold: 60,
  lengthThreshold: 4.0,
  maxIterations: 10,
  spliceThreshold: 45,
  pathPrecision: 2,
};

// =============================================================================
// Upscaling Types
// =============================================================================

export interface UpscaleOptions {
  factor: 1 | 2 | 4;
  threshold: number; // Only upscale if width or height below this
  keepOriginal: boolean; // Always true - keep both versions
}

export interface UpscaleResult {
  applied: boolean;
  originalPath: string;
  upscaledPath: string | null;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number | null;
  upscaledHeight: number | null;
  factor: number;
}

// =============================================================================
// SSE Event Types
// =============================================================================

export type SSEEventType =
  | 'batch:started'
  | 'batch:progress'
  | 'batch:completed'
  | 'batch:failed'
  | 'item:started'
  | 'item:progress'
  | 'item:completed'
  | 'item:failed';

export interface SSEEvent {
  type: SSEEventType;
  data: BatchProgress | BatchItemProgress;
  timestamp: string;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// =============================================================================
// Download Types
// =============================================================================

export interface DownloadLink {
  type: 'folder' | 'zip' | 'file';
  label: string;
  path: string;
  size: number;
  filename: string;
}

export interface BatchDownloads {
  batchId: string;
  items: {
    itemId: string;
    baseName: string;
    folder: DownloadLink;
    zip: DownloadLink;
    individualFiles: DownloadLink[];
  }[];
}