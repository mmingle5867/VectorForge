import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  type CompositeLayer,
  type CompositeLayerAnchor,
  type CompositeLayerFit,
  type CompositeTemplate,
  validateCompositeTemplate,
} from '@/lib/composite-template-schema';
import {
  getProfileListingImagesDir,
} from '@/lib/package-structure';
import { renderTemplate, type TemplateValues } from '@/services/template-renderer';

export interface CompositeRenderInput {
  template: CompositeTemplate;
  packageRoot: string;
  sourceArtworkPngPath: string;
  baseAssetsPath?: string;
  substitutions?: TemplateValues;
  outputDir?: string;
}

export interface CompositeRenderMetadata {
  role: string;
  path: string;
  format: string;
  width: number;
  height: number;
  assetProfile: string;
  marketplace: string;
  templateId: string;
  slot: number | null;
}

export interface CompositeRenderResult {
  outputPath: string;
  warnings: string[];
  metadata: CompositeRenderMetadata;
}

type ResolvedLayerSource = {
  path: string | null;
  sourceLabel: string;
};

type LayerSourceCandidates = {
  candidates: string[];
  sourceLabel: string;
};

function normalizeRelativePath(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}

function relativePackagePath(packageRoot: string, filePath: string) {
  return normalizeRelativePath(path.relative(packageRoot, filePath));
}

async function pathExists(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function buildTemplateValues(input: CompositeRenderInput): TemplateValues {
  return {
    ARTWORK_ID: '',
    PROFILE_ID: '',
    SKU: '',
    PRODUCT_NAME: path.basename(input.packageRoot),
    PROFILE_TYPE: input.template.assetProfile,
    MARKETPLACE: input.template.marketplace,
    TEMPLATE_ID: input.template.id,
    OUTPUT_ROLE: input.template.outputRole,
    CURRENT_YEAR: String(new Date().getFullYear()),
    ...(input.substitutions || {}),
  };
}

function resolveOutputPath(input: CompositeRenderInput) {
  const outputDir =
    input.outputDir || getProfileListingImagesDir(input.packageRoot, input.template.assetProfile);
  const filename = renderTemplate(input.template.outputFilename, buildTemplateValues(input));
  const safeFilename = path.basename(filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, ''));

  return path.join(outputDir, safeFilename || `${input.template.id}.${input.template.format}`);
}

function getLayerSourceCandidates(input: CompositeRenderInput, layer: CompositeLayer): LayerSourceCandidates {
  const sourceLabel = layer.source || layer.type;

  if (layer.source === 'primary-png' || (layer.type === 'artwork' && !layer.source)) {
    return { candidates: [input.sourceArtworkPngPath], sourceLabel: 'primary-png' };
  }

  if (!layer.source) {
    return { candidates: [], sourceLabel };
  }

  if (path.isAbsolute(layer.source)) {
    return { candidates: [layer.source], sourceLabel };
  }

  const normalizedSource = layer.source.replace(/\\/g, '/').replace(/^\/+/, '');
  const candidates = normalizedSource.startsWith('base-assets/')
    ? [
        path.resolve(normalizedSource),
        path.resolve(input.baseAssetsPath || './base-assets', normalizedSource.replace(/^base-assets\//, '')),
      ]
    : [
        path.resolve(input.packageRoot, normalizedSource),
        path.resolve(input.baseAssetsPath || './base-assets', normalizedSource),
        path.resolve(normalizedSource),
      ];

  return { candidates, sourceLabel };
}

async function resolveLayerSource(
  input: CompositeRenderInput,
  layer: CompositeLayer
): Promise<ResolvedLayerSource> {
  const { candidates, sourceLabel } = getLayerSourceCandidates(input, layer);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return { path: candidate, sourceLabel };
    }
  }

  return { path: candidates[0] || null, sourceLabel };
}

function dimensionTarget(
  layer: CompositeLayer,
  canvasWidth: number,
  canvasHeight: number
) {
  const scale = Number.isFinite(layer.scale) && layer.scale && layer.scale > 0 ? layer.scale : 1;

  if (layer.width || layer.height) {
    return {
      width: layer.width ? Math.round(layer.width) : undefined,
      height: layer.height ? Math.round(layer.height) : undefined,
    };
  }

  return {
    width: Math.round(canvasWidth * scale),
    height: Math.round(canvasHeight * scale),
  };
}

function sharpFit(fit: CompositeLayerFit | undefined): keyof sharp.FitEnum {
  if (fit === 'cover' || fit === 'fill' || fit === 'contain') return fit;
  return 'contain';
}

async function prepareLayerBuffer(
  layerPath: string,
  layer: CompositeLayer,
  canvasWidth: number,
  canvasHeight: number
) {
  const fit = layer.fit || 'contain';
  const target = dimensionTarget(layer, canvasWidth, canvasHeight);
  let image = sharp(layerPath).ensureAlpha();

  if (fit !== 'none') {
    image = image.resize({
      width: target.width,
      height: target.height,
      fit: sharpFit(fit),
      withoutEnlargement: false,
    });
  }

  if (layer.rotation) {
    image = image.rotate(layer.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }

  if (layer.opacity !== undefined && layer.opacity >= 0 && layer.opacity < 1) {
    const alpha = Math.round(layer.opacity * 255);
    image = image.composite([
      {
        input: Buffer.from([0, 0, 0, alpha]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ]);
  }

  const buffer = await image.png().toBuffer();
  const metadata = await sharp(buffer).metadata();
  return {
    buffer,
    width: metadata.width || 0,
    height: metadata.height || 0,
  };
}

function anchorPosition(
  anchor: CompositeLayerAnchor | undefined,
  canvasWidth: number,
  canvasHeight: number,
  layerWidth: number,
  layerHeight: number
) {
  const resolvedAnchor = anchor || 'center';
  let left = Math.round((canvasWidth - layerWidth) / 2);
  let top = Math.round((canvasHeight - layerHeight) / 2);

  if (resolvedAnchor.includes('left')) left = 0;
  if (resolvedAnchor.includes('right')) left = canvasWidth - layerWidth;
  if (resolvedAnchor === 'top' || resolvedAnchor.startsWith('top-')) top = 0;
  if (resolvedAnchor === 'bottom' || resolvedAnchor.startsWith('bottom-')) {
    top = canvasHeight - layerHeight;
  }

  return { left, top };
}

async function renderSupportedLayer(
  input: CompositeRenderInput,
  layer: CompositeLayer,
  warnings: string[]
) {
  const resolved = await resolveLayerSource(input, layer);

  if (!resolved.path || !(await pathExists(resolved.path))) {
    const message = `Composite layer source not found: ${resolved.sourceLabel}${
      resolved.path ? ` (${resolved.path})` : ''
    }`;
    if (layer.required) {
      throw new Error(message);
    }
    warnings.push(message);
    return null;
  }

  const renderedLayer = await prepareLayerBuffer(
    resolved.path,
    layer,
    input.template.width,
    input.template.height
  );
  const basePosition = anchorPosition(
    layer.anchor,
    input.template.width,
    input.template.height,
    renderedLayer.width,
    renderedLayer.height
  );

  return {
    input: renderedLayer.buffer,
    left: basePosition.left + Math.round(layer.x || 0),
    top: basePosition.top + Math.round(layer.y || 0),
    blend: layer.blendMode as sharp.Blend | undefined,
  };
}

export async function renderCompositeTemplate(
  input: CompositeRenderInput
): Promise<CompositeRenderResult> {
  const validation = validateCompositeTemplate(input.template);
  if (!validation.valid) {
    throw new Error(`Invalid composite template: ${validation.errors.join('; ')}`);
  }

  if (!(await pathExists(input.sourceArtworkPngPath))) {
    throw new Error(`Required artwork PNG not found: ${input.sourceArtworkPngPath}`);
  }

  const warnings = [...validation.warnings];
  const background =
    input.template.format === 'jpg'
      ? { r: 255, g: 255, b: 255, alpha: 1 }
      : { r: 255, g: 255, b: 255, alpha: 0 };
  let canvas = sharp({
    create: {
      width: input.template.width,
      height: input.template.height,
      channels: 4,
      background,
    },
  });

  for (const layer of input.template.layers) {
    if (layer.type !== 'background' && layer.type !== 'artwork' && layer.type !== 'watermark') {
      warnings.push(`Layer type "${layer.type}" is not rendered in Phase 3`);
      continue;
    }

    const compositeLayer = await renderSupportedLayer(input, layer, warnings);
    if (compositeLayer) {
      canvas = canvas.composite([compositeLayer]);
    }
  }

  const outputPath = resolveOutputPath(input);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (input.template.format === 'jpg') {
    await canvas
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: input.template.quality || 90 })
      .toFile(outputPath);
  } else {
    await canvas.png().toFile(outputPath);
  }

  return {
    outputPath,
    warnings,
    metadata: {
      role: input.template.outputRole,
      path: relativePackagePath(input.packageRoot, outputPath),
      format: input.template.format,
      width: input.template.width,
      height: input.template.height,
      assetProfile: input.template.assetProfile,
      marketplace: input.template.marketplace,
      templateId: input.template.id,
      slot: input.template.slot || null,
    },
  };
}
