import { ASSET_PROFILE_TYPES, type AssetProfileType } from '@/lib/package-structure';

export type CompositeImageFormat = 'jpg' | 'png' | 'webp';

export type CompositeLayerType =
  | 'background'
  | 'artwork'
  | 'watermark'
  | 'mask'
  | 'shadow'
  | 'text'
  | 'border';

export type CompositeLayerFit = 'cover' | 'contain' | 'fill' | 'none';
export type CompositeLayerAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export interface CompositeLayer {
  type: CompositeLayerType;
  source?: string;
  required?: boolean;
  fit?: CompositeLayerFit;
  scale?: number;
  anchor?: CompositeLayerAnchor;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  rotation?: number;
  blendMode?: string;
  text?: string;
  font?: string;
  fontSize?: number;
  color?: string;
}

export interface CompositeTemplateOutput {
  width: number;
  height: number;
  format: CompositeImageFormat;
  quality?: number;
  outputFilename: string;
}

export interface CompositeTemplate extends CompositeTemplateOutput {
  id: string;
  name: string;
  description?: string;
  purpose: string;
  assetProfile: AssetProfileType;
  outputRole: string;
  slot?: number;
  priority?: number;
  layers: CompositeLayer[];
}

export interface CompositeTemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const LAYER_TYPES: CompositeLayerType[] = [
  'background',
  'artwork',
  'watermark',
  'mask',
  'shadow',
  'text',
  'border',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validateLayer(layer: unknown, index: number, errors: string[], warnings: string[]) {
  if (!isRecord(layer)) {
    errors.push(`layers[${index}] must be an object`);
    return;
  }

  if (!LAYER_TYPES.includes(layer.type as CompositeLayerType)) {
    errors.push(`layers[${index}].type is unsupported`);
  }

  if (
    layer.type !== 'text' &&
    layer.type !== 'shadow' &&
    layer.type !== 'border' &&
    !isNonEmptyString(layer.source)
  ) {
    warnings.push(`layers[${index}] has no source; renderer may require one`);
  }

  if (layer.opacity !== undefined) {
    const opacity = Number(layer.opacity);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      errors.push(`layers[${index}].opacity must be between 0 and 1`);
    }
  }

  if (layer.scale !== undefined) {
    const scale = Number(layer.scale);
    if (!Number.isFinite(scale) || scale <= 0) {
      errors.push(`layers[${index}].scale must be greater than 0`);
    }
  }

  if (layer.type === 'text' && !isNonEmptyString(layer.text)) {
    warnings.push(`layers[${index}] is a text layer without text`);
  }
}

export function validateCompositeTemplate(input: unknown): CompositeTemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) {
    return { valid: false, errors: ['Template must be an object'], warnings };
  }

  for (const key of ['id', 'name', 'outputRole', 'outputFilename']) {
    if (!isNonEmptyString(input[key])) {
      errors.push(`${key} is required`);
    }
  }

  if (!ASSET_PROFILE_TYPES.includes(input.assetProfile as AssetProfileType)) {
    errors.push('assetProfile is unsupported');
  }

  if (!isNonEmptyString(input.purpose)) {
    errors.push('purpose is required');
  }

  if (!isPositiveNumber(input.width)) {
    errors.push('width must be greater than 0');
  }

  if (!isPositiveNumber(input.height)) {
    errors.push('height must be greater than 0');
  }

  if (!['jpg', 'png', 'webp'].includes(input.format as string)) {
    errors.push('format must be jpg, png, or webp');
  }

  if (input.quality !== undefined) {
    const quality = Number(input.quality);
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
      errors.push('quality must be between 1 and 100');
    }
  }

  if (input.slot !== undefined) {
    const slot = Number(input.slot);
    if (!Number.isInteger(slot) || slot < 1) {
      errors.push('slot must be a positive integer');
    }
  }

  if (!Array.isArray(input.layers) || input.layers.length === 0) {
    errors.push('layers must contain at least one layer');
  } else {
    input.layers.forEach((layer, index) => validateLayer(layer, index, errors, warnings));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function isCompositeTemplate(input: unknown): input is CompositeTemplate {
  return validateCompositeTemplate(input).valid;
}
