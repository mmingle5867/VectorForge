/**
 * VectorForge - User Settings API Route
 * GET: Retrieve current user settings
 * PUT: Update user settings
 *
 * Extended settings (marketplace preview, CNC mode) are stored
 * in the defaultSubstitutions JSON field under reserved keys prefixed with __
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

// Reserved keys stored in defaultSubstitutions JSON for extended settings
const EXTENDED_KEYS = [
  'enableMarketplacePreview',
  'enableColorTint',
  'tintColor',
  'watermarkOpacity',
  'backgroundFilename',
  'watermarkFilename',
  'cncMode',
] as const;

/**
 * Extract extended settings from the defaultSubstitutions JSON blob.
 */
function extractExtendedSettings(subs: Record<string, unknown>) {
  const extended: Record<string, unknown> = {};
  const substitutions: Record<string, string> = {};

  for (const [key, value] of Object.entries(subs)) {
    if (EXTENDED_KEYS.includes(key as (typeof EXTENDED_KEYS)[number])) {
      extended[key] = value;
    } else {
      substitutions[key] = String(value);
    }
  }

  return { extended, substitutions };
}

export async function GET() {
  try {
    const user = await requireAuth();

    if (!user.settings) {
      return NextResponse.json({
        success: true,
        settings: null,
        isFirstTime: true,
      });
    }

    // Parse the defaultSubstitutions to separate extended settings from user substitutions
    const rawSubs = (user.settings.defaultSubstitutions as Record<string, unknown>) || {};
    const { extended, substitutions } = extractExtendedSettings(rawSubs);

    return NextResponse.json({
      success: true,
      settings: {
        defaultUpscaleFactor: user.settings.defaultUpscaleFactor,
        smartUpscaleThreshold: user.settings.smartUpscaleThreshold,
        baseAssetsPath: user.settings.baseAssetsPath,
        outputPath: user.settings.outputPath,
        defaultSubstitutions: substitutions,
        // Extended settings
        enableMarketplacePreview: extended.enableMarketplacePreview ?? true,
        enableColorTint: extended.enableColorTint ?? false,
        tintColor: extended.tintColor ?? '#FFFFFF',
        watermarkOpacity: extended.watermarkOpacity ?? 80,
        backgroundFilename: extended.backgroundFilename ?? 'preview-background.jpg',
        watermarkFilename: extended.watermarkFilename ?? 'watermark.png',
        cncMode: extended.cncMode ?? true,
      },
      isFirstTime: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();

    const {
      defaultUpscaleFactor,
      smartUpscaleThreshold,
      baseAssetsPath,
      outputPath,
      defaultSubstitutions,
      // Extended settings
      enableMarketplacePreview,
      enableColorTint,
      tintColor,
      watermarkOpacity,
      backgroundFilename,
      watermarkFilename,
      cncMode,
    } = body;

    // Validate paths (must start with ./, no ..)
    if (baseAssetsPath && (!baseAssetsPath.startsWith('./') || baseAssetsPath.includes('..'))) {
      return NextResponse.json(
        { success: false, error: 'Base assets path must be relative (start with ./) and cannot contain ..' },
        { status: 400 }
      );
    }
    if (outputPath && (!outputPath.startsWith('./') || outputPath.includes('..'))) {
      return NextResponse.json(
        { success: false, error: 'Output path must be relative (start with ./) and cannot contain ..' },
        { status: 400 }
      );
    }

    // Validate upscale factor
    if (defaultUpscaleFactor && ![1, 2, 4].includes(defaultUpscaleFactor)) {
      return NextResponse.json(
        { success: false, error: 'Upscale factor must be 1, 2, or 4' },
        { status: 400 }
      );
    }

    // Validate threshold
    if (smartUpscaleThreshold && (smartUpscaleThreshold < 100 || smartUpscaleThreshold > 10000)) {
      return NextResponse.json(
        { success: false, error: 'Threshold must be between 100 and 10000' },
        { status: 400 }
      );
    }

    // Validate watermark opacity
    if (watermarkOpacity !== undefined && (watermarkOpacity < 0 || watermarkOpacity > 100)) {
      return NextResponse.json(
        { success: false, error: 'Watermark opacity must be between 0 and 100' },
        { status: 400 }
      );
    }

    // Merge user substitutions with extended settings into a single JSON blob
    const mergedSubstitutions: Record<string, string | number | boolean> = {
      ...(defaultSubstitutions || {}),
    };

    // Store extended settings in the same JSON field
    if (enableMarketplacePreview !== undefined) mergedSubstitutions.enableMarketplacePreview = enableMarketplacePreview;
    if (enableColorTint !== undefined) mergedSubstitutions.enableColorTint = enableColorTint;
    if (tintColor !== undefined) mergedSubstitutions.tintColor = tintColor;
    if (watermarkOpacity !== undefined) mergedSubstitutions.watermarkOpacity = watermarkOpacity;
    if (backgroundFilename !== undefined) mergedSubstitutions.backgroundFilename = backgroundFilename;
    if (watermarkFilename !== undefined) mergedSubstitutions.watermarkFilename = watermarkFilename;
    if (cncMode !== undefined) mergedSubstitutions.cncMode = cncMode;

    const settings = await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: {
        defaultUpscaleFactor: defaultUpscaleFactor ?? undefined,
        smartUpscaleThreshold: smartUpscaleThreshold ?? undefined,
        baseAssetsPath: baseAssetsPath ?? undefined,
        outputPath: outputPath ?? undefined,
        defaultSubstitutions: mergedSubstitutions as unknown as Record<string, string>,
      },
      create: {
        userId: user.id,
        defaultUpscaleFactor: defaultUpscaleFactor ?? 2,
        smartUpscaleThreshold: smartUpscaleThreshold ?? 2000,
        baseAssetsPath: baseAssetsPath ?? './base-assets',
        outputPath: outputPath ?? './output',
        defaultSubstitutions: mergedSubstitutions as unknown as Record<string, string>,
      },
    });

    logger.info('Settings updated', { userId: user.id });

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.error('Settings update error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}