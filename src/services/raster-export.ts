import sharp from 'sharp';
import { logger } from '@/lib/logger';

const SVG_BASE_DENSITY = 72;
const SVG_RENDER_PIXEL_LIMIT = 200_000_000;

export interface RasterExportOptions {
  width: number;
  height: number;
  format: 'jpg' | 'jpeg' | 'png';
  quality?: number;
  artworkColor?: string;
  canvasPaddingPx?: number;
  forceArtworkColor?: boolean;
}

export interface SvgRasterExportOptions extends RasterExportOptions {
  preserveColors: boolean;
  forceOpaqueVisiblePixels?: boolean;
}

function safeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 2000;
}

function safeCanvasPadding(value: number | undefined, targetWidth: number, targetHeight: number) {
  if (!Number.isFinite(value) || !value || value < 0) return 0;
  const maxPadding = Math.max(0, Math.floor((Math.min(targetWidth, targetHeight) - 1) / 2));
  return Math.min(Math.round(value), maxPadding);
}

function getSafeSvgDensity(
  sourceWidth: number | undefined,
  sourceHeight: number | undefined,
  targetWidth: number,
  targetHeight: number
): number {
  const width = sourceWidth && sourceWidth > 0 ? sourceWidth : targetWidth;
  const height = sourceHeight && sourceHeight > 0 ? sourceHeight : targetHeight;
  const targetScale = Math.min(targetWidth / width, targetHeight / height);
  const desiredDensity = targetScale > 1 ? SVG_BASE_DENSITY * targetScale : SVG_BASE_DENSITY;
  const maxSafeDensity = SVG_BASE_DENSITY * Math.sqrt(SVG_RENDER_PIXEL_LIMIT / (width * height));
  const density = Math.min(desiredDensity, maxSafeDensity);

  return Math.max(SVG_BASE_DENSITY, Math.floor(density));
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace(/^#/, '');
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

async function preparePngArtwork(input: Buffer, color: string): Promise<Buffer> {
  const artworkColor = parseHexColor(color);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];
    const isNearWhite = r >= 245 && g >= 245 && b >= 245;

    if (a === 0 || isNearWhite) {
      data[index + 3] = 0;
      continue;
    }

    data[index] = artworkColor.r;
    data[index + 1] = artworkColor.g;
    data[index + 2] = artworkColor.b;
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();
}

async function recolorVisiblePixels(input: Buffer, color: string): Promise<Buffer> {
  const artworkColor = parseHexColor(color);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += info.channels) {
    const a = data[index + 3];
    if (a === 0) continue;

    data[index] = artworkColor.r;
    data[index + 1] = artworkColor.g;
    data[index + 2] = artworkColor.b;
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();
}

async function recolorVisiblePixelsOpaque(input: Buffer, color: string): Promise<Buffer> {
  const artworkColor = parseHexColor(color);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3];
    if (alpha === 0) continue;

    data[index] = artworkColor.r;
    data[index + 1] = artworkColor.g;
    data[index + 2] = artworkColor.b;
    data[index + 3] = 255;
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();
}

async function getAlphaDiagnostics(input: Buffer) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let alphaPixels = 0;
  let minAlpha = 255;
  let maxAlpha = 0;

  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3];
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
    if (alpha > 0) {
      alphaPixels += 1;
    }
  }

  return {
    width: info.width,
    height: info.height,
    alphaPixels,
    minAlpha,
    maxAlpha,
    allTransparent: alphaPixels === 0,
  };
}

async function renderSvgInsideCanvas(input: Buffer, targetWidth: number, targetHeight: number) {
  const sourceMetadata = await sharp(input).metadata();
  const density = getSafeSvgDensity(
    sourceMetadata.width,
    sourceMetadata.height,
    targetWidth,
    targetHeight
  );
  const rendered = await sharp(input, { density })
    .resize(targetWidth, targetHeight, {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
  const metadata = await sharp(rendered).metadata();

  return {
    rendered,
    left: Math.round((targetWidth - (metadata.width || targetWidth)) / 2),
    top: Math.round((targetHeight - (metadata.height || targetHeight)) / 2),
  };
}

export async function createFixedCanvasRaster(
  input: Buffer,
  outputPath: string,
  options: RasterExportOptions
): Promise<void> {
  const targetWidth = safeDimension(options.width);
  const targetHeight = safeDimension(options.height);
  const canvasPadding = safeCanvasPadding(options.canvasPaddingPx, targetWidth, targetHeight);
  const innerWidth = Math.max(1, targetWidth - canvasPadding * 2);
  const innerHeight = Math.max(1, targetHeight - canvasPadding * 2);
  const isPng = options.format === 'png';
  const background = isPng
    ? { r: 255, g: 255, b: 255, alpha: 0 }
    : { r: 255, g: 255, b: 255, alpha: 1 };

  const resized = await sharp(input)
    .resize(innerWidth, innerHeight, {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
  const artwork = isPng || options.forceArtworkColor
    ? await preparePngArtwork(resized, options.artworkColor || '#000000')
    : resized;

  const resizedMeta = await sharp(artwork).metadata();
  const left = canvasPadding + Math.round((innerWidth - (resizedMeta.width || innerWidth)) / 2);
  const top = canvasPadding + Math.round((innerHeight - (resizedMeta.height || innerHeight)) / 2);

  const canvas = sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 4,
      background,
    },
  }).composite([{ input: artwork, left, top }]);

  if (isPng) {
    await canvas.png().toFile(outputPath);
    return;
  }

  await canvas
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: options.quality ?? 90 })
    .toFile(outputPath);
}

export async function createFixedCanvasSvgRaster(
  input: Buffer,
  outputPath: string,
  options: SvgRasterExportOptions
): Promise<void> {
  const targetWidth = safeDimension(options.width);
  const targetHeight = safeDimension(options.height);
  const canvasPadding = safeCanvasPadding(options.canvasPaddingPx, targetWidth, targetHeight);
  const innerWidth = Math.max(1, targetWidth - canvasPadding * 2);
  const innerHeight = Math.max(1, targetHeight - canvasPadding * 2);
  const isPng = options.format === 'png';
  const background = isPng
    ? { r: 255, g: 255, b: 255, alpha: 0 }
    : { r: 255, g: 255, b: 255, alpha: 1 };
  const { rendered, left, top } = await renderSvgInsideCanvas(input, innerWidth, innerHeight);
  const artwork = isPng
    ? options.forceOpaqueVisiblePixels
      ? await recolorVisiblePixelsOpaque(rendered, options.artworkColor || '#000000')
      : rendered
    : options.preserveColors
      ? rendered
      : await recolorVisiblePixels(rendered, '#000000');

  const canvas = sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 4,
      background,
    },
  }).composite([{ input: artwork, left: canvasPadding + left, top: canvasPadding + top }]);

  if (isPng) {
    const pngBuffer = await canvas.png().toBuffer();
    const alphaDiagnostics = await getAlphaDiagnostics(pngBuffer);
    if (alphaDiagnostics.allTransparent) {
      logger.warn('SVG-derived PNG export is fully transparent', {
        outputPath,
        ...alphaDiagnostics,
      });
    }
    await sharp(pngBuffer).toFile(outputPath);
    return;
  }

  await canvas
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: options.quality ?? 90 })
    .toFile(outputPath);
}
