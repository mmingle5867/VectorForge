import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { optimize } from 'svgo';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { DEFAULT_CONVERSION_OPTIONS } from '@/lib/types';
import { normalizeSvgRoot } from '@/lib/svg-normalize';

const previewTuneSchema = z.object({
  blur: z.number().min(0).max(5),
  pathPrecision: z.number().int().min(0).max(8),
  cornerThreshold: z.number().min(0).max(180),
  filterSpeckle: z.number().int().min(0).max(128),
  lengthThreshold: z.number().min(1).max(20),
  spliceThreshold: z.number().min(0).max(180),
  colorPrecision: z.number().int().min(1).max(12),
  layerDifference: z.number().int().min(0).max(128),
});

function getSvgDiagnostics(svg: string) {
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;
    const parsed = previewTuneSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.message },
        { status: 400 }
      );
    }

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item || item.batchId !== batchId || item.batch.userId !== user.id) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (!item.uploadPath) {
      return NextResponse.json(
        { success: false, error: 'No file available for preview' },
        { status: 404 }
      );
    }

    const settings = parsed.data;
    const userSettings = (user.settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const cncMode = (userSettings.cncMode as boolean) ?? true;
    const startTime = Date.now();
    const imageBuffer = await readFile(item.uploadPath);
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    if (!originalWidth || !originalHeight) {
      return NextResponse.json(
        { success: false, error: 'Unable to read image dimensions' },
        { status: 400 }
      );
    }

    const upscaleFactor = item.upscaleFactor as 1 | 2 | 4;
    const upscaleApplied =
      upscaleFactor > 1 &&
      (originalWidth < item.batch.smartUpscaleThreshold ||
        originalHeight < item.batch.smartUpscaleThreshold);
    const traceWidth = upscaleApplied ? originalWidth * upscaleFactor : originalWidth;
    const traceHeight = upscaleApplied ? originalHeight * upscaleFactor : originalHeight;

    let sharpImage = sharp(imageBuffer).ensureAlpha();
    if (upscaleApplied) {
      sharpImage = sharpImage.resize(traceWidth, traceHeight, {
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: false,
      });
    }
    if (settings.blur > 0) {
      sharpImage = sharpImage.blur(settings.blur);
    }

    const rgbaData = await sharpImage.raw().toBuffer();

    const vtracer = await import('wasm_vtracer');
    if (!vtracer.isReady()) {
      vtracer.init();
    }

    const config = new vtracer.TracerConfig();
    config.setColorMode(cncMode ? vtracer.ColorMode.Binary : vtracer.ColorMode.Color);
    config.setHierarchical(vtracer.Hierarchical.Stacked);
    config.setFilterSpeckle(settings.filterSpeckle);
    config.setColorPrecision(settings.colorPrecision);
    config.setLayerDifference(settings.layerDifference);
    config.setCornerThreshold(settings.cornerThreshold);
    config.setLengthThreshold(settings.lengthThreshold);
    config.setMaxIterations(DEFAULT_CONVERSION_OPTIONS.maxIterations);
    config.setSpliceThreshold(settings.spliceThreshold);
    config.setPathPrecision(settings.pathPrecision);

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

    const normalizedSvg = normalizeSvgRoot(optimized.data, traceWidth, traceHeight);
    const debugDir = path.join(process.cwd(), 'logs');
    const debugSvgPath = path.join(debugDir, `debug-preview-${item.id}.svg`);
    await mkdir(debugDir, { recursive: true });
    await writeFile(debugSvgPath, normalizedSvg, 'utf-8');

    const diagnostics = getSvgDiagnostics(normalizedSvg);
    const svgBase64 = Buffer.from(normalizedSvg).toString('base64');

    return NextResponse.json({
      success: true,
      preview: {
        itemId: item.id,
        filename: item.originalFilename,
        originalWidth,
        originalHeight,
        traceWidth,
        traceHeight,
        upscaleApplied,
        upscaleFactor: upscaleApplied ? upscaleFactor : 1,
        svgSize: Buffer.byteLength(normalizedSvg, 'utf-8'),
        svgBase64,
        debugSvgPath,
        diagnostics,
        processingTimeMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    logger.error('Preview tune error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}
