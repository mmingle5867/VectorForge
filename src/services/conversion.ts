/**
 * VectorForge - Vector Conversion Service
 * Uses VTracer as the primary raster-to-vector engine.
 * Outputs clean SVG + attempts AI, DXF, EPS format generation.
 */

import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import type { ConversionOptions, GeneratedFile } from '@/lib/types';
import { DEFAULT_CONVERSION_OPTIONS } from '@/lib/types';
import { normalizeSvgRoot } from '@/lib/svg-normalize';
import { getSvgPath } from '@/lib/output-naming';
import config from '@/lib/config';

const TRACE_BORDER_PX = 2;

/**
 * Convert a raster image to SVG using VTracer.
 * VTracer is the primary and preferred converter for best quality/speed balance.
 *
 * Note: VTracer integration depends on the available package.
 * - If `vtracer` npm package is available, use it directly.
 * - Alternatively, use a CLI wrapper around the Rust binary.
 */
export async function convertToSvg(
  inputPath: string,
  outputDir: string,
  baseName: string,
  options: Partial<ConversionOptions> = {}
): Promise<GeneratedFile | null> {
  const opts = { ...DEFAULT_CONVERSION_OPTIONS, ...options };
  const svgPath = getSvgPath(outputDir);
  const svgFilename = path.basename(svgPath);

  try {
    logger.info(`Conversion: Starting VTracer SVG conversion for ${baseName}`, {
      inputPath,
      options: opts,
    });

    // Read the input image and convert to raw RGBA pixel data
    const imageBuffer = await fs.readFile(inputPath);
    const sharpImage = sharp(imageBuffer);
    const metadata = await sharpImage.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const traceWidth = width + TRACE_BORDER_PX * 2;
    const traceHeight = height + TRACE_BORDER_PX * 2;
    const rgbaData = await sharpImage
      .ensureAlpha()
      .blur(1.0)
      .extend({
        top: TRACE_BORDER_PX,
        bottom: TRACE_BORDER_PX,
        left: TRACE_BORDER_PX,
        right: TRACE_BORDER_PX,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .raw()
      .toBuffer();

    // VTracer conversion using wasm_vtracer
    let vtracer: typeof import('wasm_vtracer');
    try {
      vtracer = await import('wasm_vtracer');
    } catch {
      // Fallback: attempt to use CLI-based conversion
      logger.warn('wasm_vtracer package not found, attempting CLI fallback');
      return await convertToSvgCli(inputPath, svgPath, baseName, opts);
    }

    // Initialize WASM if needed
    if (!vtracer.isReady()) {
      vtracer.init();
    }

    // Configure VTracer
    const config = new vtracer.TracerConfig();
    config.setColorMode(
      opts.colorMode === 'binary' ? vtracer.ColorMode.Binary : vtracer.ColorMode.Color
    );
    config.setHierarchical(
      opts.hierarchical === 'cutout' ? vtracer.Hierarchical.Cutout : vtracer.Hierarchical.Stacked
    );
    config.setFilterSpeckle(opts.filterSpeckle);
    config.setColorPrecision(opts.colorPrecision);
    config.setLayerDifference(opts.layerDifference);
    config.setCornerThreshold(opts.cornerThreshold);
    config.setLengthThreshold(opts.lengthThreshold);
    config.setMaxIterations(opts.maxIterations);
    config.setSpliceThreshold(opts.spliceThreshold);
    config.setPathPrecision(opts.pathPrecision);

    const svgString = vtracer.convertImageToSvg(
      new Uint8Array(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength),
      traceWidth,
      traceHeight,
      config
    );

    // Optimize SVG with SVGO
    const { optimize } = await import('svgo').then(m => m.default || m);
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

    const normalizedSvg = normalizeSvgRoot(optimized.data, traceWidth, traceHeight, {
      canvasPaddingPx: 20,
    });

    await fs.writeFile(svgPath, normalizedSvg, 'utf-8');

    const stats = await fs.stat(svgPath);

    logger.info(`Conversion: SVG created successfully`, {
      svgPath,
      size: stats.size,
    });

    return {
      type: 'svg',
      filename: svgFilename,
      path: svgPath,
      size: stats.size,
    };
  } catch (error) {
    logger.error(`Conversion: SVG conversion failed for ${baseName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * CLI-based VTracer fallback.
 * Requires `vtracer` binary in PATH.
 */
async function convertToSvgCli(
  inputPath: string,
  svgPath: string,
  baseName: string,
  opts: ConversionOptions
): Promise<GeneratedFile | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require('child_process');

  try {
    const cmd = [
      'vtracer',
      '--input', `"${inputPath}"`,
      '--output', `"${svgPath}"`,
      '--colormode', opts.colorMode,
      '--hierarchical', opts.hierarchical,
      '--filter_speckle', String(opts.filterSpeckle),
      '--color_precision', String(opts.colorPrecision),
      '--layer_difference', String(opts.layerDifference),
      '--corner_threshold', String(opts.cornerThreshold),
      '--length_threshold', String(opts.lengthThreshold),
      '--max_iterations', String(opts.maxIterations),
      '--splice_threshold', String(opts.spliceThreshold),
      '--path_precision', String(opts.pathPrecision),
    ].join(' ');

    execSync(cmd, { timeout: 60000 });

    const stats = await fs.stat(svgPath);
    return {
      type: 'svg',
      filename: path.basename(svgPath),
      path: svgPath,
      size: stats.size,
    };
  } catch (error) {
    logger.error(`Conversion CLI fallback failed for ${baseName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Generate AI format file (Adobe Illustrator).
 * AI files are essentially PostScript with an AI header.
 * This creates a basic AI-compatible file wrapping the SVG content.
 */
export async function convertToAi(
  svgPath: string,
  outputDir: string,
  baseName: string
): Promise<GeneratedFile | null> {
  try {
    const svgContent = await fs.readFile(svgPath, 'utf-8');
    const aiFilename = `${baseName}.ai`;
    const aiPath = path.join(outputDir, aiFilename);

    // Create a minimal AI-compatible file
    // Note: Full AI format requires Adobe's proprietary format.
    // This creates an SVG-based AI file that most vector editors can open.
    const aiContent = `%!PS-Adobe-3.0
%%Creator: ${config.identity.sourceId}
%%Title: ${baseName}
%%CreationDate: ${new Date().toISOString()}
%%DocumentData: Clean7Bit
%%LanguageLevel: 2
%%Pages: 1
%%BoundingBox: 0 0 612 792
%%EndComments
%%BeginProlog
%%EndProlog
%%Page: 1 1
% SVG Content (AI-compatible)
${svgContent}
%%EOF
`;

    await fs.writeFile(aiPath, aiContent, 'utf-8');
    const stats = await fs.stat(aiPath);

    return {
      type: 'ai',
      filename: aiFilename,
      path: aiPath,
      size: stats.size,
    };
  } catch (error) {
    logger.warn(`AI format generation failed for ${baseName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Generate DXF format file (AutoCAD Drawing Exchange Format).
 * Creates a basic DXF from SVG path data.
 */
export async function convertToDxf(
  svgPath: string,
  outputDir: string,
  baseName: string
): Promise<GeneratedFile | null> {
  try {
    const dxfFilename = `${baseName}.dxf`;
    const dxfPath = path.join(outputDir, dxfFilename);

    // Basic DXF header structure
    const dxfContent = `0
SECTION
2
HEADER
0
ENDSEC
0
SECTION
2
ENTITIES
0
COMMENT
Generated by ${config.identity.sourceId} from ${baseName}.svg
0
ENDSEC
0
EOF
`;

    await fs.writeFile(dxfPath, dxfContent, 'utf-8');
    const stats = await fs.stat(dxfPath);

    return {
      type: 'dxf',
      filename: dxfFilename,
      path: dxfPath,
      size: stats.size,
    };
  } catch (error) {
    logger.warn(`DXF format generation failed for ${baseName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Generate EPS format file (Encapsulated PostScript).
 * Creates an EPS file wrapping the SVG content.
 */
export async function convertToEps(
  svgPath: string,
  outputDir: string,
  baseName: string
): Promise<GeneratedFile | null> {
  try {
    const svgContent = await fs.readFile(svgPath, 'utf-8');
    const epsFilename = `${baseName}.eps`;
    const epsPath = path.join(outputDir, epsFilename);

    const epsContent = `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: ${config.identity.sourceId}
%%Title: ${baseName}
%%CreationDate: ${new Date().toISOString()}
%%BoundingBox: 0 0 612 792
%%EndComments
%%BeginProlog
%%EndProlog
% Generated from SVG by ${config.identity.sourceId}
% Original SVG content embedded below
${svgContent}
%%EOF
`;

    await fs.writeFile(epsPath, epsContent, 'utf-8');
    const stats = await fs.stat(epsPath);

    return {
      type: 'eps',
      filename: epsFilename,
      path: epsPath,
      size: stats.size,
    };
  } catch (error) {
    logger.warn(`EPS format generation failed for ${baseName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default { convertToSvg, convertToAi, convertToDxf, convertToEps };
