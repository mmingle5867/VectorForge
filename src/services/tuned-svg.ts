import sharp from 'sharp';
import { optimize } from 'svgo';
import { z } from 'zod';
import { DEFAULT_CONVERSION_OPTIONS } from '@/lib/types';
import { normalizeSvgRoot } from '@/lib/svg-normalize';

const TRACE_BORDER_PX = 2;

export const previewTuneSchema = z.object({
  colorMode: z.enum(['color', 'binary']).default('binary'),
  preUpscaleBlur: z.number().min(0).max(5).default(0),
  blur: z.number().min(0).max(20),
  blurPasses: z.number().int().min(1).max(3).default(1),
  pathPrecision: z.number().int().min(0).max(8),
  cornerThreshold: z.number().min(0).max(180),
  filterSpeckle: z.number().int().min(0).max(20),
  lengthThreshold: z.number().min(3.5).max(10),
  spliceThreshold: z.number().min(0).max(180),
  colorPrecision: z.number().int().min(1).max(8),
  layerDifference: z.number().int().min(0).max(255),
});

export type PreviewTuneSettings = z.infer<typeof previewTuneSchema>;

export const FIELD_RANGES: Record<string, string> = {
  preUpscaleBlur: '0-5',
  colorMode: 'color or binary',
  blur: '0-20',
  blurPasses: '1-3',
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
}

export async function generateTunedSvg(input: TunedSvgInput) {
  const upscaleApplied =
    input.upscaleFactor > 1 &&
    (input.originalWidth < input.smartUpscaleThreshold ||
      input.originalHeight < input.smartUpscaleThreshold);
  const resizedWidth = upscaleApplied
    ? input.originalWidth * input.upscaleFactor
    : input.originalWidth;
  const resizedHeight = upscaleApplied
    ? input.originalHeight * input.upscaleFactor
    : input.originalHeight;
  const traceWidth = resizedWidth + TRACE_BORDER_PX * 2;
  const traceHeight = resizedHeight + TRACE_BORDER_PX * 2;

  let sharpImage = sharp(input.imageBuffer).ensureAlpha();
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

  const rgbaData = await sharpImage
    .extend({
      top: TRACE_BORDER_PX,
      bottom: TRACE_BORDER_PX,
      left: TRACE_BORDER_PX,
      right: TRACE_BORDER_PX,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .raw()
    .toBuffer();

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

  const svg = normalizeSvgRoot(optimized.data, traceWidth, traceHeight);

  return {
    svg,
    originalWidth: input.originalWidth,
    originalHeight: input.originalHeight,
    traceWidth,
    traceHeight,
    upscaleApplied,
    upscaleFactor: upscaleApplied ? input.upscaleFactor : 1,
    svgSize: Buffer.byteLength(svg, 'utf-8'),
    diagnostics: getSvgDiagnostics(svg),
  };
}
