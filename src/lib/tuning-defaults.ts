export interface TuningExportSettings {
  preUpscaleBlur: number;
  preprocessingBlur: number;
  blurPasses: number;
  edgePaddingPx: number;
  svgCanvasPaddingPx: number;
  pathPrecision: number;
  cornerThreshold: number;
  filterSpeckle: number;
  lengthThreshold: number;
  spliceThreshold: number;
  colorPrecision: number;
  layerDifference: number;
  rasterExportWidth: number;
  rasterExportHeight: number;
  pngExportArtworkColor: string;
  pngWhiteTransparencyThreshold: number;
}

export type TuningExportSettingKey = keyof TuningExportSettings;

export interface TuningExportRange {
  min: number;
  max: number;
  step: number;
}

export const FACTORY_TUNING_EXPORT_DEFAULTS: TuningExportSettings = {
  preUpscaleBlur: 0,
  preprocessingBlur: 1,
  blurPasses: 1,
  edgePaddingPx: 2,
  svgCanvasPaddingPx: 20,
  pathPrecision: 3,
  cornerThreshold: 70,
  filterSpeckle: 6,
  lengthThreshold: 4,
  spliceThreshold: 45,
  colorPrecision: 6,
  layerDifference: 16,
  rasterExportWidth: 2000,
  rasterExportHeight: 2000,
  pngExportArtworkColor: '#000000',
  pngWhiteTransparencyThreshold: 245,
};

export const RECOMMENDED_SMOOTH_TUNING_EXPORT_DEFAULTS: TuningExportSettings = {
  ...FACTORY_TUNING_EXPORT_DEFAULTS,
  preUpscaleBlur: 0,
  preprocessingBlur: 1,
  blurPasses: 1,
  edgePaddingPx: 2,
  svgCanvasPaddingPx: 20,
  pathPrecision: 3,
  cornerThreshold: 70,
  filterSpeckle: 6,
};

export const TUNING_EXPORT_RANGES: Record<TuningExportSettingKey, TuningExportRange> = {
  preUpscaleBlur: { min: 0, max: 5, step: 0.1 },
  preprocessingBlur: { min: 0, max: 20, step: 0.1 },
  blurPasses: { min: 1, max: 3, step: 1 },
  edgePaddingPx: { min: 0, max: 20, step: 1 },
  svgCanvasPaddingPx: { min: 0, max: 100, step: 1 },
  pathPrecision: { min: 0, max: 8, step: 1 },
  cornerThreshold: { min: 0, max: 180, step: 5 },
  filterSpeckle: { min: 0, max: 20, step: 1 },
  lengthThreshold: { min: 3.5, max: 10, step: 0.5 },
  spliceThreshold: { min: 0, max: 180, step: 5 },
  colorPrecision: { min: 1, max: 8, step: 1 },
  layerDifference: { min: 0, max: 255, step: 1 },
  rasterExportWidth: { min: 256, max: 10000, step: 100 },
  rasterExportHeight: { min: 256, max: 10000, step: 100 },
  pngExportArtworkColor: { min: 0, max: 0, step: 1 },
  pngWhiteTransparencyThreshold: { min: 0, max: 255, step: 1 },
};

export const TUNING_EXPORT_HELP: Record<TuningExportSettingKey, string> = {
  preUpscaleBlur: 'Preview/Tune: applies light blur before upscaling. Recommended 0-0.75.',
  preprocessingBlur: 'Preview/Tune: smooths raster edges after upscaling and before tracing. Recommended 0.75-2.0.',
  blurPasses: 'Preview/Tune: repeats the post-upscale blur before edge padding. Use 1 normally.',
  edgePaddingPx: 'Preview/Tune default: white padding added before tracing so artwork does not touch image edges.',
  svgCanvasPaddingPx: 'Final SVG viewport padding added after tracing. Expands the canvas/viewBox without moving or changing paths.',
  pathPrecision: 'Preview/Tune: decimal precision for SVG path coordinates. VTracer accepts 0-8.',
  cornerThreshold: 'Preview/Tune: higher values preserve more hard corners; lower values smooth and round more corners.',
  filterSpeckle: 'Preview/Tune: removes small noisy shapes. Higher is cleaner but may remove details.',
  lengthThreshold: 'Preview/Tune: minimum path segment length. Higher simplifies jagged detail.',
  spliceThreshold: 'Preview/Tune: controls path merging. Higher can create fewer paths but may lose detail.',
  colorPrecision: 'Preview/Tune: color precision retained before tracing. VTracer accepts 1-8.',
  layerDifference: 'Preview/Tune: controls color or gradient layer separation. Hard range is 0-255.',
  rasterExportWidth: 'Used by approve/save exports: fixed raster canvas width in pixels.',
  rasterExportHeight: 'Used by approve/save exports: fixed raster canvas height in pixels.',
  pngExportArtworkColor: 'Used by approve/save PNG exports: recolors non-white artwork pixels to this color.',
  pngWhiteTransparencyThreshold: 'Used by approve/save PNG exports: RGB values at or above this threshold become transparent.',
};

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}
