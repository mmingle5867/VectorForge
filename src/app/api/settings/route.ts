/**
 * VectorForge - User Settings API Route
 * GET: Retrieve current user settings
 * PUT: Update user settings
 *
 * Extended settings (marketplace preview, CNC mode) are stored
 * in the defaultSubstitutions JSON field under reserved keys prefixed with __
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import config from '@/lib/config';
import {
  FACTORY_TUNING_EXPORT_DEFAULTS,
  TUNING_EXPORT_RANGES,
  isHexColor,
  type TuningExportSettingKey,
} from '@/lib/tuning-defaults';

// Reserved keys stored in defaultSubstitutions JSON for extended settings
const EXTENDED_KEYS = [
  'enableMarketplacePreview',
  'enableColorTint',
  'tintColor',
  'watermarkOpacity',
  'backgroundFilename',
  'watermarkFilename',
  'copyBaseAssetsToOutput',
  'cncMode',
  'preUpscaleBlur',
  'preprocessingBlur',
  'blurPasses',
  'edgePaddingPx',
  'pathPrecision',
  'cornerThreshold',
  'filterSpeckle',
  'lengthThreshold',
  'spliceThreshold',
  'colorPrecision',
  'layerDifference',
  'rasterExportWidth',
  'rasterExportHeight',
  'pngExportArtworkColor',
  'pngWhiteTransparencyThreshold',
  'manualEditorPath',
  'manualEditorAllowMultipleFiles',
  'manualEditorFileTypes',
  'manualEditorDefaultAction',
  'companyName',
  'contactName',
  'website',
  'email',
  'phone',
  'supportUrl',
  'defaultLicenseType',
  'templateVariables',
] as const;

const TUNING_EXPORT_KEYS = [
  'preUpscaleBlur',
  'preprocessingBlur',
  'blurPasses',
  'edgePaddingPx',
  'pathPrecision',
  'cornerThreshold',
  'filterSpeckle',
  'lengthThreshold',
  'spliceThreshold',
  'colorPrecision',
  'layerDifference',
  'rasterExportWidth',
  'rasterExportHeight',
  'pngExportArtworkColor',
  'pngWhiteTransparencyThreshold',
] as const satisfies readonly TuningExportSettingKey[];

const settingsFallbacks = {
  ...FACTORY_TUNING_EXPORT_DEFAULTS,
  rasterExportWidth: config.processing.rasterExportWidth,
  rasterExportHeight: config.processing.rasterExportHeight,
  pngExportArtworkColor: config.processing.pngExportArtworkColor,
  pngWhiteTransparencyThreshold: config.processing.pngWhiteTransparencyThreshold,
};

function getStringArraySetting(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeTemplateVariables(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const variables: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim().toUpperCase();
    if (/^[A-Z0-9_]+$/.test(normalizedKey)) {
      variables[normalizedKey] = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
    }
  }
  return variables;
}

function addLegacyTemplateSetting(
  substitutions: Record<string, string>,
  key: string,
  value: unknown
) {
  if (typeof value === 'string' && value && substitutions[key] === undefined) {
    substitutions[key] = value;
  }
}

function mergeLegacyTemplateVariables(
  substitutions: Record<string, string>,
  extended: Record<string, unknown>
) {
  const merged = {
    ...normalizeTemplateVariables(extended.templateVariables),
    ...substitutions,
  };

  addLegacyTemplateSetting(merged, 'COMPANY_NAME', extended.companyName);
  addLegacyTemplateSetting(merged, 'CONTACT_NAME', extended.contactName);
  addLegacyTemplateSetting(merged, 'WEBSITE', extended.website);
  addLegacyTemplateSetting(merged, 'EMAIL', extended.email);
  addLegacyTemplateSetting(merged, 'PHONE', extended.phone);
  addLegacyTemplateSetting(merged, 'SUPPORT_URL', extended.supportUrl);
  addLegacyTemplateSetting(merged, 'LICENSE_TYPE', extended.defaultLicenseType);

  return merged;
}

function validateTemplateVariables(value: unknown) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Template variables must be key/value pairs';
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    const trimmedKey = key.trim();
    if (!/^[A-Z0-9_]+$/.test(trimmedKey)) {
      return `Template variable "${key}" must use uppercase letters, numbers, and underscores only`;
    }
  }

  return null;
}

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

function getNumberSetting(
  extended: Record<string, unknown>,
  key: TuningExportSettingKey
) {
  const value = extended[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return settingsFallbacks[key];
}

function getTuningExportSettings(extended: Record<string, unknown>) {
  return {
    preUpscaleBlur: getNumberSetting(extended, 'preUpscaleBlur'),
    preprocessingBlur: getNumberSetting(extended, 'preprocessingBlur'),
    blurPasses: getNumberSetting(extended, 'blurPasses'),
    edgePaddingPx: getNumberSetting(extended, 'edgePaddingPx'),
    pathPrecision: getNumberSetting(extended, 'pathPrecision'),
    cornerThreshold: getNumberSetting(extended, 'cornerThreshold'),
    filterSpeckle: getNumberSetting(extended, 'filterSpeckle'),
    lengthThreshold: getNumberSetting(extended, 'lengthThreshold'),
    spliceThreshold: getNumberSetting(extended, 'spliceThreshold'),
    colorPrecision: getNumberSetting(extended, 'colorPrecision'),
    layerDifference: getNumberSetting(extended, 'layerDifference'),
    rasterExportWidth: getNumberSetting(extended, 'rasterExportWidth'),
    rasterExportHeight: getNumberSetting(extended, 'rasterExportHeight'),
    pngExportArtworkColor: isHexColor(extended.pngExportArtworkColor)
      ? extended.pngExportArtworkColor
      : settingsFallbacks.pngExportArtworkColor,
    pngWhiteTransparencyThreshold: getNumberSetting(extended, 'pngWhiteTransparencyThreshold'),
  };
}

function validateTuningExportSetting(key: TuningExportSettingKey, value: unknown) {
  if (value === undefined) return null;

  if (key === 'pngExportArtworkColor') {
    return isHexColor(value) ? null : 'PNG export artwork color must be a valid hex color like #000000';
  }

  const numberValue = Number(value);
  const range = TUNING_EXPORT_RANGES[key];
  if (!Number.isFinite(numberValue) || numberValue < range.min || numberValue > range.max) {
    return `${key} must be between ${range.min} and ${range.max}`;
  }

  if (
    ['blurPasses', 'edgePaddingPx', 'pathPrecision', 'filterSpeckle', 'colorPrecision', 'layerDifference', 'rasterExportWidth', 'rasterExportHeight', 'pngWhiteTransparencyThreshold'].includes(
      key
    ) &&
    !Number.isInteger(numberValue)
  ) {
    return `${key} must be a whole number`;
  }

  return null;
}

function normalizeConfiguredPath(value: string) {
  return path.resolve(process.cwd(), value).toLowerCase();
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
    const mergedSubstitutionVariables = mergeLegacyTemplateVariables(substitutions, extended);

    return NextResponse.json({
      success: true,
      settings: {
        defaultUpscaleFactor: user.settings.defaultUpscaleFactor,
        smartUpscaleThreshold: user.settings.smartUpscaleThreshold,
        baseAssetsPath: user.settings.baseAssetsPath,
        outputPath: user.settings.outputPath,
        defaultSubstitutions: mergedSubstitutionVariables,
        // Extended settings
        enableMarketplacePreview: extended.enableMarketplacePreview ?? true,
        enableColorTint: extended.enableColorTint ?? false,
        tintColor: extended.tintColor ?? '#FFFFFF',
        watermarkOpacity: extended.watermarkOpacity ?? 80,
        backgroundFilename: extended.backgroundFilename ?? 'preview-background.jpg',
        watermarkFilename: extended.watermarkFilename ?? 'watermark.png',
        copyBaseAssetsToOutput: extended.copyBaseAssetsToOutput ?? false,
        cncMode: extended.cncMode ?? true,
        manualEditorPath: typeof extended.manualEditorPath === 'string' ? extended.manualEditorPath : '',
        manualEditorAllowMultipleFiles: extended.manualEditorAllowMultipleFiles ?? false,
        manualEditorFileTypes: getStringArraySetting(extended.manualEditorFileTypes, ['PNG']),
        manualEditorDefaultAction:
          typeof extended.manualEditorDefaultAction === 'string'
            ? extended.manualEditorDefaultAction
            : 'Open Preferred File Type',
        ...getTuningExportSettings(extended),
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
      copyBaseAssetsToOutput,
      cncMode,
      manualEditorPath,
      manualEditorAllowMultipleFiles,
      manualEditorFileTypes,
      manualEditorDefaultAction,
      companyName,
      contactName,
      website,
      email,
      phone,
      supportUrl,
      defaultLicenseType,
      templateVariables,
      preUpscaleBlur,
      preprocessingBlur,
      blurPasses,
      edgePaddingPx,
      pathPrecision,
      cornerThreshold,
      filterSpeckle,
      lengthThreshold,
      spliceThreshold,
      colorPrecision,
      layerDifference,
      rasterExportWidth,
      rasterExportHeight,
      pngExportArtworkColor,
      pngWhiteTransparencyThreshold,
    } = body;

    const tuningExportBody = {
      preUpscaleBlur,
      preprocessingBlur,
      blurPasses,
      edgePaddingPx,
      pathPrecision,
      cornerThreshold,
      filterSpeckle,
      lengthThreshold,
      spliceThreshold,
      colorPrecision,
      layerDifference,
      rasterExportWidth,
      rasterExportHeight,
      pngExportArtworkColor,
      pngWhiteTransparencyThreshold,
    };

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

    const nextBaseAssetsPath = baseAssetsPath ?? user.settings?.baseAssetsPath ?? './base-assets';
    const nextOutputPath = outputPath ?? user.settings?.outputPath ?? './output';
    if (normalizeConfiguredPath(nextBaseAssetsPath) === normalizeConfiguredPath(nextOutputPath)) {
      return NextResponse.json(
        { success: false, error: 'Output path and base assets path must be different directories' },
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

    const allowedEditorFileTypes = ['PNG', 'JPG', 'SVG'];
    if (
      manualEditorFileTypes !== undefined &&
      (!Array.isArray(manualEditorFileTypes) ||
        manualEditorFileTypes.some((fileType) => !allowedEditorFileTypes.includes(fileType)))
    ) {
      return NextResponse.json(
        { success: false, error: 'Manual editor file types must be PNG, JPG, or SVG' },
        { status: 400 }
      );
    }

    const allowedEditorActions = ['Open Preferred File Type', 'Open All Selected File Types'];
    if (
      manualEditorDefaultAction !== undefined &&
      !allowedEditorActions.includes(manualEditorDefaultAction)
    ) {
      return NextResponse.json(
        { success: false, error: 'Manual editor default action is invalid' },
        { status: 400 }
      );
    }

    for (const key of TUNING_EXPORT_KEYS) {
      const validationError = validateTuningExportSetting(key, tuningExportBody[key]);
      if (validationError) {
        return NextResponse.json({ success: false, error: validationError }, { status: 400 });
      }
    }

    const templateVariableError = validateTemplateVariables(templateVariables);
    if (templateVariableError) {
      return NextResponse.json({ success: false, error: templateVariableError }, { status: 400 });
    }

    // Merge user substitutions with extended settings into a single JSON blob
    const mergedSubstitutions: Record<
      string,
      string | number | boolean | string[] | Record<string, string>
    > = {
      ...(defaultSubstitutions || {}),
    };

    // Store extended settings in the same JSON field
    if (enableMarketplacePreview !== undefined) mergedSubstitutions.enableMarketplacePreview = enableMarketplacePreview;
    if (enableColorTint !== undefined) mergedSubstitutions.enableColorTint = enableColorTint;
    if (tintColor !== undefined) mergedSubstitutions.tintColor = tintColor;
    if (watermarkOpacity !== undefined) mergedSubstitutions.watermarkOpacity = watermarkOpacity;
    if (backgroundFilename !== undefined) mergedSubstitutions.backgroundFilename = backgroundFilename;
    if (watermarkFilename !== undefined) mergedSubstitutions.watermarkFilename = watermarkFilename;
    if (copyBaseAssetsToOutput !== undefined) {
      mergedSubstitutions.copyBaseAssetsToOutput = Boolean(copyBaseAssetsToOutput);
    }
    if (cncMode !== undefined) mergedSubstitutions.cncMode = cncMode;
    if (manualEditorPath !== undefined) mergedSubstitutions.manualEditorPath = String(manualEditorPath);
    if (manualEditorAllowMultipleFiles !== undefined) {
      mergedSubstitutions.manualEditorAllowMultipleFiles = Boolean(manualEditorAllowMultipleFiles);
    }
    if (manualEditorFileTypes !== undefined) mergedSubstitutions.manualEditorFileTypes = manualEditorFileTypes;
    if (manualEditorDefaultAction !== undefined) {
      mergedSubstitutions.manualEditorDefaultAction = String(manualEditorDefaultAction);
    }
    if (templateVariables !== undefined) {
      Object.assign(mergedSubstitutions, normalizeTemplateVariables(templateVariables));
    }
    addLegacyTemplateSetting(mergedSubstitutions as Record<string, string>, 'COMPANY_NAME', companyName);
    addLegacyTemplateSetting(mergedSubstitutions as Record<string, string>, 'CONTACT_NAME', contactName);
    addLegacyTemplateSetting(mergedSubstitutions as Record<string, string>, 'WEBSITE', website);
    addLegacyTemplateSetting(mergedSubstitutions as Record<string, string>, 'EMAIL', email);
    addLegacyTemplateSetting(mergedSubstitutions as Record<string, string>, 'PHONE', phone);
    addLegacyTemplateSetting(mergedSubstitutions as Record<string, string>, 'SUPPORT_URL', supportUrl);
    addLegacyTemplateSetting(
      mergedSubstitutions as Record<string, string>,
      'LICENSE_TYPE',
      defaultLicenseType
    );
    for (const key of TUNING_EXPORT_KEYS) {
      if (tuningExportBody[key] !== undefined) {
        mergedSubstitutions[key] =
          key === 'pngExportArtworkColor' ? tuningExportBody[key] : Number(tuningExportBody[key]);
      }
    }

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
