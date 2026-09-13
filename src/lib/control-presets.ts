import {
  FACTORY_TUNING_EXPORT_DEFAULTS,
  TUNING_EXPORT_RANGES,
} from '@/lib/tuning-defaults';

export interface TuneControlSettings {
  colorMode: 'color' | 'binary';
  binaryTraceColor: string;
  traceThicknessPx: number;
  preUpscaleBlur: number;
  blur: number;
  blurPasses: number;
  rasterSourcePaddingPx: number;
  svgCanvasPaddingPx: number;
  exportCanvasPaddingPx: number;
  pathPrecision: number;
  cornerThreshold: number;
  filterSpeckle: number;
  lengthThreshold: number;
  spliceThreshold: number;
  colorPrecision: number;
  layerDifference: number;
}

export interface RasterEditorPreparation {
  blur: number;
  upscaleFactor: number;
}

export interface ControlPreset {
  id: string;
  name: string;
  description: string;
  settings: TuneControlSettings;
  rasterPreparation: RasterEditorPreparation;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_TUNE_CONTROL_SETTINGS: TuneControlSettings = {
  colorMode: 'binary',
  binaryTraceColor: '#000000',
  traceThicknessPx: 0,
  preUpscaleBlur: FACTORY_TUNING_EXPORT_DEFAULTS.preUpscaleBlur,
  blur: FACTORY_TUNING_EXPORT_DEFAULTS.preprocessingBlur,
  blurPasses: FACTORY_TUNING_EXPORT_DEFAULTS.blurPasses,
  rasterSourcePaddingPx: FACTORY_TUNING_EXPORT_DEFAULTS.rasterSourcePaddingPx,
  svgCanvasPaddingPx: FACTORY_TUNING_EXPORT_DEFAULTS.svgCanvasPaddingPx,
  exportCanvasPaddingPx: FACTORY_TUNING_EXPORT_DEFAULTS.exportCanvasPaddingPx,
  pathPrecision: FACTORY_TUNING_EXPORT_DEFAULTS.pathPrecision,
  cornerThreshold: FACTORY_TUNING_EXPORT_DEFAULTS.cornerThreshold,
  filterSpeckle: FACTORY_TUNING_EXPORT_DEFAULTS.filterSpeckle,
  lengthThreshold: FACTORY_TUNING_EXPORT_DEFAULTS.lengthThreshold,
  spliceThreshold: FACTORY_TUNING_EXPORT_DEFAULTS.spliceThreshold,
  colorPrecision: FACTORY_TUNING_EXPORT_DEFAULTS.colorPrecision,
  layerDifference: FACTORY_TUNING_EXPORT_DEFAULTS.layerDifference,
};

export const DEFAULT_RASTER_EDITOR_PREPARATION: RasterEditorPreparation = {
  blur: 0,
  upscaleFactor: 1,
};

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeTuneControlSettings(value: unknown): TuneControlSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    colorMode: input.colorMode === 'color' ? 'color' : 'binary',
    binaryTraceColor: typeof input.binaryTraceColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.binaryTraceColor)
      ? input.binaryTraceColor.toUpperCase()
      : DEFAULT_TUNE_CONTROL_SETTINGS.binaryTraceColor,
    traceThicknessPx: numberInRange(input.traceThicknessPx, DEFAULT_TUNE_CONTROL_SETTINGS.traceThicknessPx, 0, 20),
    preUpscaleBlur: numberInRange(input.preUpscaleBlur, DEFAULT_TUNE_CONTROL_SETTINGS.preUpscaleBlur, 0, 5),
    blur: numberInRange(input.blur, DEFAULT_TUNE_CONTROL_SETTINGS.blur, 0, 20),
    blurPasses: Math.round(numberInRange(input.blurPasses, DEFAULT_TUNE_CONTROL_SETTINGS.blurPasses, 1, 3)),
    rasterSourcePaddingPx: numberInRange(input.rasterSourcePaddingPx, DEFAULT_TUNE_CONTROL_SETTINGS.rasterSourcePaddingPx, -100, 200),
    svgCanvasPaddingPx: numberInRange(input.svgCanvasPaddingPx, DEFAULT_TUNE_CONTROL_SETTINGS.svgCanvasPaddingPx, 0, 100),
    exportCanvasPaddingPx: numberInRange(input.exportCanvasPaddingPx, DEFAULT_TUNE_CONTROL_SETTINGS.exportCanvasPaddingPx, 0, 300),
    pathPrecision: Math.round(numberInRange(input.pathPrecision, DEFAULT_TUNE_CONTROL_SETTINGS.pathPrecision, TUNING_EXPORT_RANGES.pathPrecision.min, TUNING_EXPORT_RANGES.pathPrecision.max)),
    cornerThreshold: numberInRange(input.cornerThreshold, DEFAULT_TUNE_CONTROL_SETTINGS.cornerThreshold, 0, 180),
    filterSpeckle: Math.round(numberInRange(input.filterSpeckle, DEFAULT_TUNE_CONTROL_SETTINGS.filterSpeckle, 0, 20)),
    lengthThreshold: numberInRange(input.lengthThreshold, DEFAULT_TUNE_CONTROL_SETTINGS.lengthThreshold, 3.5, 10),
    spliceThreshold: numberInRange(input.spliceThreshold, DEFAULT_TUNE_CONTROL_SETTINGS.spliceThreshold, 0, 180),
    colorPrecision: Math.round(numberInRange(input.colorPrecision, DEFAULT_TUNE_CONTROL_SETTINGS.colorPrecision, 1, 8)),
    layerDifference: Math.round(numberInRange(input.layerDifference, DEFAULT_TUNE_CONTROL_SETTINGS.layerDifference, 0, 255)),
  };
}

export function normalizeRasterEditorPreparation(value: unknown): RasterEditorPreparation {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const requestedFactor = Number(input.upscaleFactor);
  return {
    blur: numberInRange(input.blur, 0, 0, 20),
    upscaleFactor: Number.isInteger(requestedFactor) && requestedFactor >= 1 && requestedFactor <= 10 ? requestedFactor : 1,
  };
}

export function normalizeControlPresets(value: unknown): ControlPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ControlPreset[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const input = entry as Record<string, unknown>;
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    if (!id || !name) return [];
    const createdAt = typeof input.createdAt === 'string' ? input.createdAt : new Date(0).toISOString();
    const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : createdAt;
    return [{
      id,
      name,
      description: typeof input.description === 'string' ? input.description.trim().slice(0, 500) : '',
      settings: normalizeTuneControlSettings(input.settings),
      rasterPreparation: normalizeRasterEditorPreparation(input.rasterPreparation),
      createdAt,
      updatedAt,
    }];
  }).slice(0, 100);
}
