import sharp from 'sharp';
import { optimize } from 'svgo';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { DEFAULT_CONVERSION_OPTIONS } from '@/lib/types';
import { normalizeSvgRoot } from '@/lib/svg-normalize';

const TRACE_BORDER_PX = 2;
const PNG_ALPHA_TRACE_THRESHOLD = 32;

const numberWithDefault = (schema: z.ZodDefault<z.ZodNumber>) =>
  z.preprocess((value) => {
    if (value === null || value === '') return undefined;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, schema);

export const previewTuneSchema = z.object({
  colorMode: z.enum(['color', 'binary']).default('binary'),
  preUpscaleBlur: numberWithDefault(z.number().min(0).max(5).default(0)),
  blur: numberWithDefault(z.number().min(0).max(20).default(0)),
  blurPasses: numberWithDefault(z.number().int().min(1).max(3).default(1)),
  rasterSourcePaddingPx: numberWithDefault(z.number().int().min(0).max(200).default(20)),
  svgCanvasPaddingPx: numberWithDefault(z.number().int().min(0).max(100).default(20)),
  exportCanvasPaddingPx: numberWithDefault(z.number().int().min(0).max(300).default(0)),
  pathPrecision: numberWithDefault(z.number().int().min(0).max(8).default(3)),
  cornerThreshold: numberWithDefault(z.number().min(0).max(180).default(70)),
  filterSpeckle: numberWithDefault(z.number().int().min(0).max(20).default(6)),
  lengthThreshold: numberWithDefault(z.number().min(3.5).max(10).default(4)),
  spliceThreshold: numberWithDefault(z.number().min(0).max(180).default(45)),
  colorPrecision: numberWithDefault(z.number().int().min(1).max(8).default(6)),
  layerDifference: numberWithDefault(z.number().int().min(0).max(255).default(16)),
});

export type PreviewTuneSettings = z.infer<typeof previewTuneSchema>;

export const FIELD_RANGES: Record<string, string> = {
  preUpscaleBlur: '0-5',
  colorMode: 'color or binary',
  blur: '0-20',
  blurPasses: '1-3',
  rasterSourcePaddingPx: '0-200',
  svgCanvasPaddingPx: '0-100',
  exportCanvasPaddingPx: '0-300',
  pathPrecision: '0-8',
  cornerThreshold: '0-180',
  filterSpeckle: '0-20',
  lengthThreshold: '3.5-10',
  spliceThreshold: '0-180',
  colorPrecision: '1-8',
  layerDifference: '0-255',
};

export function getPreviewValidationError(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path[0]?.toString();
  const allowedRange = field ? FIELD_RANGES[field] : undefined;
  const message =
    field && allowedRange
      ? `${field} must be between ${allowedRange}`
      : issue?.message || 'Invalid preview settings';

  return { message, field, allowedRange };
}

export function getSvgDiagnostics(svg: string) {
  const rootSvgTag = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
  const firstPathTag = svg.match(/<path\b[^>]*>/i)?.[0] || '';
  const pathTags = svg.match(/<path\b[^>]*>/gi) || [];
  const viewBox = rootSvgTag.match(/\sviewBox=(["'])(.*?)\1/i)?.[2] || '';
  const width = rootSvgTag.match(/\swidth=(["'])(.*?)\1/i)?.[2] || '';
  const height = rootSvgTag.match(/\sheight=(["'])(.*?)\1/i)?.[2] || '';
  const fillNoneCount = pathTags.filter((tag) => /\sfill=(["'])none\1/i.test(tag)).length;
  const strokeCount = pathTags.filter((tag) => /\sstroke=/i.test(tag)).length;
  const opacityZeroCount = pathTags.filter((tag) =>
    /(?:\sopacity|\sfill-opacity|\sstroke-opacity)=(["'])0(?:\.0+)?\1/i.test(tag)
  ).length;
  const hasVisibleFill = pathTags.some((tag) => {
    const fill = tag.match(/\sfill=(["'])(.*?)\1/i)?.[2]?.trim().toLowerCase();
    const opacity = tag.match(/(?:\sopacity|\sfill-opacity)=(["'])(.*?)\1/i)?.[2]?.trim();
    return fill !== 'none' && opacity !== '0' && opacity !== '0.0';
  });
  const hasVisibleStroke = pathTags.some((tag) => {
    const stroke = tag.match(/\sstroke=(["'])(.*?)\1/i)?.[2]?.trim().toLowerCase();
    const opacity = tag.match(/(?:\sopacity|\sstroke-opacity)=(["'])(.*?)\1/i)?.[2]?.trim();
    return !!stroke && stroke !== 'none' && opacity !== '0' && opacity !== '0.0';
  });

  return {
    svgLength: svg.length,
    pathCount: pathTags.length,
    rootSvgTag,
    viewBox,
    width,
    height,
    firstPathTag,
    fillNoneCount,
    strokeCount,
    opacityZeroCount,
    hasVisibleFill,
    hasVisibleStroke,
  };
}

export interface TunedSvgInput {
  imageBuffer: Buffer;
  originalWidth: number;
  originalHeight: number;
  upscaleFactor: 1 | 2 | 4;
  smartUpscaleThreshold: number;
  cncMode: boolean;
  settings: PreviewTuneSettings;
  sourceMimeType?: string | null;
  sourcePath?: string | null;
}

function getTraceInputDiagnostics(
  rgbaData: Buffer,
  width: number,
  height: number,
  sourceMetadata: sharp.Metadata,
  alphaMatteApplied: boolean,
  alphaDiagnostics?: {
    alphaThreshold: number;
    alphaPixelsAboveThreshold: number;
    borderAlphaPixels: number;
    borderAlphaPixelsAboveThreshold: number;
    minBorderAlpha: number;
    maxBorderAlpha: number;
  }
) {
  let transparentPixels = 0;
  let darkPixels = 0;
  let nonWhitePixels = 0;
  let minRgb = 255;
  let maxRgb = 0;
  let minAlpha = 255;
  let maxAlpha = 0;

  for (let index = 0; index < rgbaData.length; index += 4) {
    const red = rgbaData[index];
    const green = rgbaData[index + 1];
    const blue = rgbaData[index + 2];
    const alpha = rgbaData[index + 3];
    const brightness = (red + green + blue) / 3;

    minRgb = Math.min(minRgb, red, green, blue);
    maxRgb = Math.max(maxRgb, red, green, blue);
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);

    if (alpha === 0) transparentPixels += 1;
    if (brightness < 245) nonWhitePixels += 1;
    if (brightness < 128) darkPixels += 1;
  }

  return {
    width,
    height,
    sourceHasAlpha: Boolean(sourceMetadata.hasAlpha),
    sourceChannels: sourceMetadata.channels ?? null,
    alphaMatteApplied,
    ...(alphaDiagnostics || {}),
    alphaChannelDetected: maxAlpha > minAlpha || minAlpha < 255,
    transparentPixels,
    darkPixels,
    nonWhitePixels,
    minRgb,
    maxRgb,
    minAlpha,
    maxAlpha,
  };
}

function getAlphaDiagnosticsBeforeMatte(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  alphaThreshold: number
) {
  let alphaPixelsAboveThreshold = 0;
  let borderAlphaPixels = 0;
  let borderAlphaPixelsAboveThreshold = 0;
  let minBorderAlpha = 255;
  let maxBorderAlpha = 0;
  const seenBorderPixels = new Set<number>();

  const visitBorderPixel = (x: number, y: number) => {
    const pixelIndex = y * width + x;
    if (seenBorderPixels.has(pixelIndex)) return;
    seenBorderPixels.add(pixelIndex);

    const alpha = data[pixelIndex * channels + 3];
    if (alpha > 0) borderAlphaPixels += 1;
    if (alpha > alphaThreshold) borderAlphaPixelsAboveThreshold += 1;
    minBorderAlpha = Math.min(minBorderAlpha, alpha);
    maxBorderAlpha = Math.max(maxBorderAlpha, alpha);
  };

  for (let index = 0; index < data.length; index += channels) {
    if (data[index + 3] > alphaThreshold) alphaPixelsAboveThreshold += 1;
  }

  for (let x = 0; x < width; x += 1) {
    visitBorderPixel(x, 0);
    visitBorderPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    visitBorderPixel(0, y);
    visitBorderPixel(width - 1, y);
  }

  return {
    alphaThreshold,
    alphaPixelsAboveThreshold,
    borderAlphaPixels,
    borderAlphaPixelsAboveThreshold,
    minBorderAlpha,
    maxBorderAlpha,
  };
}

async function prepareTraceRgbaData(
  sharpImage: sharp.Sharp,
  sourceMetadata: sharp.Metadata
) {
  if (!sourceMetadata.hasAlpha) {
    const extended = sharpImage.extend({
      top: TRACE_BORDER_PX,
      bottom: TRACE_BORDER_PX,
      left: TRACE_BORDER_PX,
      right: TRACE_BORDER_PX,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });

    return {
      rgbaData: await extended
        .flatten({ background: '#ffffff' })
        .ensureAlpha()
        .raw()
        .toBuffer(),
      alphaMatteApplied: false,
      alphaDiagnostics: undefined,
    };
  }

  const extended = sharpImage.extend({
    top: TRACE_BORDER_PX,
    bottom: TRACE_BORDER_PX,
    left: TRACE_BORDER_PX,
    right: TRACE_BORDER_PX,
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  });
  const { data, info } = await extended
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaDiagnostics = getAlphaDiagnosticsBeforeMatte(
    data,
    info.width,
    info.height,
    info.channels,
    PNG_ALPHA_TRACE_THRESHOLD
  );

  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3];
    const visibleAlpha = alpha <= PNG_ALPHA_TRACE_THRESHOLD
      ? 0
      : (alpha - PNG_ALPHA_TRACE_THRESHOLD) / (255 - PNG_ALPHA_TRACE_THRESHOLD);
    const matteValue = 255 - Math.round(visibleAlpha * 255);

    data[index] = matteValue;
    data[index + 1] = matteValue;
    data[index + 2] = matteValue;
    data[index + 3] = 255;
  }

  return {
    rgbaData: Buffer.from(data),
    alphaMatteApplied: true,
    alphaDiagnostics,
  };
}

export async function generateTunedSvg(input: TunedSvgInput) {
  const sourceMetadata = await sharp(input.imageBuffer).metadata();
  const rasterSourcePaddingPx = input.settings.rasterSourcePaddingPx ?? input.settings.svgCanvasPaddingPx ?? 20;
  const paddedWidth = input.originalWidth + rasterSourcePaddingPx * 2;
  const paddedHeight = input.originalHeight + rasterSourcePaddingPx * 2;
  const upscaleApplied =
    input.upscaleFactor > 1 &&
    (paddedWidth < input.smartUpscaleThreshold ||
      paddedHeight < input.smartUpscaleThreshold);
  const resizedWidth = upscaleApplied
    ? paddedWidth * input.upscaleFactor
    : paddedWidth;
  const resizedHeight = upscaleApplied
    ? paddedHeight * input.upscaleFactor
    : paddedHeight;
  const traceWidth = resizedWidth + TRACE_BORDER_PX * 2;
  const traceHeight = resizedHeight + TRACE_BORDER_PX * 2;

  const sourcePaddedBuffer = await sharp(input.imageBuffer)
    .ensureAlpha()
    .extend({
      top: rasterSourcePaddingPx,
      bottom: rasterSourcePaddingPx,
      left: rasterSourcePaddingPx,
      right: rasterSourcePaddingPx,
      background: sourceMetadata.hasAlpha
        ? { r: 255, g: 255, b: 255, alpha: 0 }
        : { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
  let sharpImage = sharp(sourcePaddedBuffer).ensureAlpha();
  if (input.settings.preUpscaleBlur > 0) {
    sharpImage = sharpImage.blur(input.settings.preUpscaleBlur);
  }
  if (upscaleApplied) {
    sharpImage = sharpImage.resize(resizedWidth, resizedHeight, {
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    });
  }
  if (input.settings.blur > 0) {
    for (let pass = 0; pass < input.settings.blurPasses; pass += 1) {
      sharpImage = sharpImage.blur(input.settings.blur);
    }
  }

  const { rgbaData, alphaMatteApplied, alphaDiagnostics } = await prepareTraceRgbaData(sharpImage, sourceMetadata);
  const traceInputDiagnostics = getTraceInputDiagnostics(
    rgbaData,
    traceWidth,
    traceHeight,
    sourceMetadata,
    alphaMatteApplied,
    alphaDiagnostics
  );

  const vtracer = await import('wasm_vtracer');
  if (!vtracer.isReady()) {
    vtracer.init();
  }

  const config = new vtracer.TracerConfig();
  const colorMode = input.settings.colorMode ?? (input.cncMode ? 'binary' : 'color');
  config.setColorMode(colorMode === 'binary' ? vtracer.ColorMode.Binary : vtracer.ColorMode.Color);
  config.setHierarchical(vtracer.Hierarchical.Stacked);
  config.setFilterSpeckle(input.settings.filterSpeckle);
  config.setColorPrecision(input.settings.colorPrecision);
  config.setLayerDifference(input.settings.layerDifference);
  config.setCornerThreshold(input.settings.cornerThreshold);
  config.setLengthThreshold(input.settings.lengthThreshold);
  config.setMaxIterations(DEFAULT_CONVERSION_OPTIONS.maxIterations);
  config.setSpliceThreshold(input.settings.spliceThreshold);
  config.setPathPrecision(input.settings.pathPrecision);

  const svgString = vtracer.convertImageToSvg(
    new Uint8Array(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength),
    traceWidth,
    traceHeight,
    config
  );
  const rawSvgDiagnostics = getSvgDiagnostics(svgString);

  const optimized = optimize(svgString, {
    multipass: true,
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            mergePaths: false,
          },
        },
      },
      'removeDimensions',
      {
        name: 'addAttributesToSVGElement',
        params: {
          attributes: [{ xmlns: 'http://www.w3.org/2000/svg' }],
        },
      },
    ],
  });

  const svg = normalizeSvgRoot(optimized.data, traceWidth, traceHeight, {
    canvasPaddingPx: input.settings.svgCanvasPaddingPx,
  });
  const diagnostics = getSvgDiagnostics(svg);
  const traceDiagnostics = {
    ...traceInputDiagnostics,
    rawSvgLength: svgString.length,
    rawPathCount: rawSvgDiagnostics.pathCount,
    svgLength: Buffer.byteLength(svg, 'utf-8'),
    pathCount: diagnostics.pathCount,
  };

  if (input.sourceMimeType?.toLowerCase().includes('png') || input.sourcePath?.toLowerCase().endsWith('.png')) {
    logger.info('PNG preview trace diagnostics', traceDiagnostics);
  }

  return {
    svg,
    originalWidth: input.originalWidth,
    originalHeight: input.originalHeight,
    traceWidth: traceWidth + input.settings.svgCanvasPaddingPx * 2,
    traceHeight: traceHeight + input.settings.svgCanvasPaddingPx * 2,
    upscaleApplied,
    upscaleFactor: upscaleApplied ? input.upscaleFactor : 1,
    svgSize: Buffer.byteLength(svg, 'utf-8'),
    diagnostics: {
      ...diagnostics,
      traceInput: traceDiagnostics,
    },
  };
}
