/**
 * VectorForge - Test Optimization Settings API Route
 * Processes up to 3 images with given VTracer settings and returns
 * before/after comparisons (original size vs SVG size + SVG preview).
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { mkdir, rm } from 'fs/promises';
import sharp from 'sharp';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { VTracerSettings } from '@/lib/vtracer-presets';
import { getSVGOConfig, vtracerPresetToSVGO } from '@/lib/svgo-config';

interface TestResultItem {
  itemId: string;
  filename: string;
  originalSize: number;
  originalWidth: number;
  originalHeight: number;
  svgSizeRaw: number;
  svgSizeOptimized: number;
  svgBase64: string;
  compressionRatio: string;
  svgoReduction: string;
  processingTimeMs: number;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { itemIds, settings } = body as { itemIds: string[]; settings: VTracerSettings };

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0 || !settings) {
      return NextResponse.json(
        { success: false, error: 'itemIds (array, 1-3) and settings are required' },
        { status: 400 }
      );
    }

    // Limit to 3 images
    const limitedIds = itemIds.slice(0, 3);

    // Find the batch items
    const items = await prisma.batchItem.findMany({
      where: { id: { in: limitedIds } },
      include: { batch: true },
    });

    // Verify ownership
    const validItems = items.filter((item) => item.batch.userId === user.id && item.uploadPath);

    if (validItems.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid items found' },
        { status: 404 }
      );
    }

    // Create a temporary directory for the test
    const tmpDir = path.join(os.tmpdir(), `vectorforge-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    try {
      const results: TestResultItem[] = [];

      for (const item of validItems) {
        const startTime = Date.now();

        // Read original file
        const originalBuffer = await readFile(item.uploadPath!);
        const originalSize = originalBuffer.length;

        // Get original dimensions
        const metadata = await sharp(originalBuffer).metadata();
        const originalWidth = metadata.width || 0;
        const originalHeight = metadata.height || 0;

        // Convert to SVG using VTracer with the provided settings
        let svgString: string;
        try {
          const vtracer = await import('wasm_vtracer');
          if (!vtracer.isReady()) {
            vtracer.init();
          }

          // Get raw RGBA pixel data using sharp
          const sharpImg = sharp(originalBuffer);
          const rgbaData = await sharpImg.ensureAlpha().blur(1.0).raw().toBuffer();

          const config = new vtracer.TracerConfig();
          config.setColorMode(vtracer.ColorMode.Color);
          config.setHierarchical(vtracer.Hierarchical.Stacked);
          config.setFilterSpeckle(settings.filterSpeckle);
          config.setColorPrecision(settings.colorPrecision);
          config.setLayerDifference(settings.gradientStep);
          config.setCornerThreshold(settings.cornerThreshold);
          config.setLengthThreshold(settings.segmentLength);
          config.setMaxIterations(10);
          config.setSpliceThreshold(settings.spliceThreshold);
          config.setPathPrecision(2);

          svgString = vtracer.convertImageToSvg(
            new Uint8Array(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength),
            originalWidth,
            originalHeight,
            config
          );
        } catch {
          // Fallback: generate a placeholder SVG for testing
          svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${originalWidth}" height="${originalHeight}" viewBox="0 0 ${originalWidth} ${originalHeight}">
            <rect width="100%" height="100%" fill="#f0f0f0"/>
            <text x="50%" y="50%" text-anchor="middle" dy=".3em" font-size="20" fill="#666">
              VTracer test (install vtracer for real conversion)
            </text>
          </svg>`;
        }

        const svgSizeRaw = Buffer.byteLength(svgString, 'utf-8');

        // Always run SVGO after VTracer
        let optimizedSvg = svgString;
        try {
          const svgoModule = await import('svgo');
          const optimize = svgoModule.optimize || (svgoModule as unknown as { default: typeof svgoModule }).default?.optimize;
          const svgoPreset = vtracerPresetToSVGO(settings.preset);
          const svgoConfig = getSVGOConfig(svgoPreset);
          const optimized = optimize(svgString, svgoConfig);
          optimizedSvg = optimized.data;
        } catch {
          // SVGO not available, use raw SVG
        }

        const svgSizeOptimized = Buffer.byteLength(optimizedSvg, 'utf-8');
        const processingTime = Date.now() - startTime;

        // Generate base64 preview of the optimized SVG
        const svgBase64 = Buffer.from(optimizedSvg).toString('base64');

        results.push({
          itemId: item.id,
          filename: item.originalFilename,
          originalSize,
          originalWidth,
          originalHeight,
          svgSizeRaw,
          svgSizeOptimized,
          svgBase64,
          compressionRatio: (svgSizeOptimized / originalSize * 100).toFixed(1),
          svgoReduction: svgSizeRaw > 0
            ? ((1 - svgSizeOptimized / svgSizeRaw) * 100).toFixed(1)
            : '0',
          processingTimeMs: processingTime,
        });
      }

      // Clean up temp directory
      await rm(tmpDir, { recursive: true, force: true });

      return NextResponse.json({
        success: true,
        results,
        settings,
        svgoPreset: vtracerPresetToSVGO(settings.preset),
      });
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Test optimization error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to test optimization settings' },
      { status: 500 }
    );
  }
}