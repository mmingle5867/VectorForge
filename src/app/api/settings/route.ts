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
  DEFAULT_MANAGED_PATHS,
  normalizeManagedPath,
  validateManagedPathValue,
} from '@/lib/path-management';
import {
  FACTORY_TUNING_EXPORT_DEFAULTS,
  TUNING_EXPORT_RANGES,
  isHexColor,
  type TuningExportSettingKey,
} from '@/lib/tuning-defaults';
import { configureDefaultImportStorageForUser } from '@/services/profile-storage';
import { normalizeStatusColors } from '@/lib/status-colors';

// Reserved keys stored in defaultSubstitutions JSON for extended settings
const EXTENDED_KEYS = [
  'storageRootPath',
  'workingPath',
  'uploadPath',
  'bundleOutputPath',
  'archivePath',
  'templatePath',
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
  'rasterSourcePaddingPx',
  'svgCanvasPaddingPx',
  'exportCanvasPaddingPx',
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
  'vectorEditorPath',
  'vectorEditorAllowMultipleFiles',
  'vectorEditorFileTypes',
  'companyName',
  'contactName',
  'website',
  'email',
  'phone',
  'supportUrl',
  'defaultLicenseType',
  'templateVariables',
  'statusColors',
  'workingVersionKeepCount',
  'workingVersionRetentionDays',
  'lastTuneControlSettings',
  'rasterEditorPreparation',
  'controlPresets',
] as const;

const TUNING_EXPORT_KEYS = [
  'preUpscaleBlur',
  'preprocessingBlur',
  'blurPasses',
  'edgePaddingPx',
  'rasterSourcePaddingPx',
  'svgCanvasPaddingPx',
  'exportCanvasPaddingPx',
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

function getPathSetting(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
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
  if (key === 'rasterSourcePaddingPx' && extended.rasterSourcePaddingPx === undefined) {
    const legacySvgCanvasPadding = extended.svgCanvasPaddingPx;
    if (typeof legacySvgCanvasPadding === 'number' && Number.isFinite(legacySvgCanvasPadding)) {
      return legacySvgCanvasPadding;
    }
    if (typeof legacySvgCanvasPadding === 'string' && legacySvgCanvasPadding.trim() !== '') {
      const parsed = Number(legacySvgCanvasPadding);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  const value = extended[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return settingsFallbacks[key];
}

function getWholeNumberSetting(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function validateWorkingVersionRetention(label: string, value: unknown, min: number, max: number) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return `${label} must be a whole number between ${min} and ${max}`;
  }
  return null;
}

function getTuningExportSettings(extended: Record<string, unknown>) {
  return {
    preUpscaleBlur: getNumberSetting(extended, 'preUpscaleBlur'),
    preprocessingBlur: getNumberSetting(extended, 'preprocessingBlur'),
    blurPasses: getNumberSetting(extended, 'blurPasses'),
    edgePaddingPx: getNumberSetting(extended, 'edgePaddingPx'),
    rasterSourcePaddingPx: getNumberSetting(extended, 'rasterSourcePaddingPx'),
    svgCanvasPaddingPx: getNumberSetting(extended, 'svgCanvasPaddingPx'),
    exportCanvasPaddingPx: getNumberSetting(extended, 'exportCanvasPaddingPx'),
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
    ['blurPasses', 'edgePaddingPx', 'rasterSourcePaddingPx', 'svgCanvasPaddingPx', 'exportCanvasPaddingPx', 'pathPrecision', 'filterSpeckle', 'colorPrecision', 'layerDifference', 'rasterExportWidth', 'rasterExportHeight', 'pngWhiteTransparencyThreshold'].includes(
      key
    ) &&
    !Number.isInteger(numberValue)
  ) {
    return `${key} must be a whole number`;
  }

  return null;
}

function validateEditorPathSetting(label: string, value: unknown) {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    return `${label} must be a text path`;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes('\0')) {
    return `${label} cannot contain null characters`;
  }

  if (!path.isAbsolute(trimmed) && !path.win32.isAbsolute(trimmed)) {
    return `${label} must be an absolute path`;
  }

  return null;
}

function normalizeEditorPathSetting(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
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
        storageRootPath: getPathSetting(
          extended.storageRootPath,
          DEFAULT_MANAGED_PATHS.storageRootPath
        ),
        workingPath: getPathSetting(extended.workingPath, DEFAULT_MANAGED_PATHS.workingPath),
        uploadPath: getPathSetting(extended.uploadPath, config.paths.uploads),
        bundleOutputPath: getPathSetting(
          extended.bundleOutputPath,
          DEFAULT_MANAGED_PATHS.bundleOutputPath
        ),
        archivePath: getPathSetting(extended.archivePath, DEFAULT_MANAGED_PATHS.archivePath),
        templatePath: getPathSetting(extended.templatePath, DEFAULT_MANAGED_PATHS.templatePath),
        defaultSubstitutions: mergedSubstitutionVariables,
        statusColors: normalizeStatusColors(extended.statusColors),
        workingVersionKeepCount: getWholeNumberSetting(extended.workingVersionKeepCount, 3),
        workingVersionRetentionDays: getWholeNumberSetting(extended.workingVersionRetentionDays, 30),
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
        vectorEditorPath: typeof extended.vectorEditorPath === 'string' ? extended.vectorEditorPath : '',
        vectorEditorAllowMultipleFiles: extended.vectorEditorAllowMultipleFiles ?? false,
        vectorEditorFileTypes: getStringArraySetting(extended.vectorEditorFileTypes, ['SVG']),
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
      storageRootPath,
      workingPath,
      uploadPath,
      bundleOutputPath,
      archivePath,
      baseAssetsPath,
      outputPath,
      templatePath,
      defaultSubstitutions,
      statusColors,
      workingVersionKeepCount,
      workingVersionRetentionDays,
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
      vectorEditorPath,
      vectorEditorAllowMultipleFiles,
      vectorEditorFileTypes,
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
      rasterSourcePaddingPx,
      svgCanvasPaddingPx,
      exportCanvasPaddingPx,
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
      rasterSourcePaddingPx,
      svgCanvasPaddingPx,
      exportCanvasPaddingPx,
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

    const pathInputs = {
      storageRootPath,
      workingPath,
      uploadPath,
      bundleOutputPath,
      archivePath,
      baseAssetsPath,
      outputPath,
      templatePath,
    };
    for (const [label, value] of Object.entries(pathInputs)) {
      if (value !== undefined) {
        const error = validateManagedPathValue(String(value));
        if (error) {
          return NextResponse.json(
            { success: false, error: `${label} is invalid: ${error}` },
            { status: 400 }
          );
        }
      }
    }

    const nextBaseAssetsPath = baseAssetsPath ?? user.settings?.baseAssetsPath ?? './base-assets';
    const nextOutputPath = outputPath ?? user.settings?.outputPath ?? './output';
    if (normalizeManagedPath(nextBaseAssetsPath) === normalizeManagedPath(nextOutputPath)) {
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

    const workingVersionKeepCountError = validateWorkingVersionRetention(
      'Recent working versions to keep',
      workingVersionKeepCount,
      1,
      100
    );
    if (workingVersionKeepCountError) {
      return NextResponse.json({ success: false, error: workingVersionKeepCountError }, { status: 400 });
    }

    const workingVersionRetentionDaysError = validateWorkingVersionRetention(
      'Working-version retention days',
      workingVersionRetentionDays,
      0,
      3650
    );
    if (workingVersionRetentionDaysError) {
      return NextResponse.json({ success: false, error: workingVersionRetentionDaysError }, { status: 400 });
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

    const manualEditorPathError = validateEditorPathSetting(
      'Manual editor path',
      manualEditorPath
    );
    if (manualEditorPathError) {
      return NextResponse.json(
        { success: false, error: manualEditorPathError },
        { status: 400 }
      );
    }

    const vectorEditorPathError = validateEditorPathSetting(
      'Vector editor path',
      vectorEditorPath
    );
    if (vectorEditorPathError) {
      return NextResponse.json(
        { success: false, error: vectorEditorPathError },
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

    const allowedVectorEditorFileTypes = ['SVG', 'DXF', 'EPS', 'PDF'];
    if (
      vectorEditorFileTypes !== undefined &&
      (!Array.isArray(vectorEditorFileTypes) ||
        vectorEditorFileTypes.some((fileType) => !allowedVectorEditorFileTypes.includes(fileType)))
    ) {
      return NextResponse.json(
        { success: false, error: 'Vector editor file types must be SVG, DXF, EPS, or PDF' },
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
    const existingExtended = user.settings?.defaultSubstitutions && typeof user.settings.defaultSubstitutions === 'object'
      ? user.settings.defaultSubstitutions as Record<string, unknown>
      : {};
    const mergedSubstitutions: Record<string, unknown> = {
      ...(defaultSubstitutions || {}),
    };
    for (const key of ['lastTuneControlSettings', 'rasterEditorPreparation', 'controlPresets'] as const) {
      if (existingExtended[key] !== undefined) mergedSubstitutions[key] = existingExtended[key];
    }

    // Store extended settings in the same JSON field
    if (storageRootPath !== undefined) {
      mergedSubstitutions.storageRootPath = String(storageRootPath);
    }
    if (workingPath !== undefined) mergedSubstitutions.workingPath = String(workingPath);
    if (uploadPath !== undefined) mergedSubstitutions.uploadPath = String(uploadPath);
    if (bundleOutputPath !== undefined) {
      mergedSubstitutions.bundleOutputPath = String(bundleOutputPath);
    }
    if (archivePath !== undefined) mergedSubstitutions.archivePath = String(archivePath);
    if (templatePath !== undefined) mergedSubstitutions.templatePath = String(templatePath);
    if (statusColors !== undefined) mergedSubstitutions.statusColors = normalizeStatusColors(statusColors);
    if (workingVersionKeepCount !== undefined) {
      mergedSubstitutions.workingVersionKeepCount = Number(workingVersionKeepCount);
    }
    if (workingVersionRetentionDays !== undefined) {
      mergedSubstitutions.workingVersionRetentionDays = Number(workingVersionRetentionDays);
    }
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
    if (manualEditorPath !== undefined) {
      mergedSubstitutions.manualEditorPath = String(normalizeEditorPathSetting(manualEditorPath));
    }
    if (manualEditorAllowMultipleFiles !== undefined) {
      mergedSubstitutions.manualEditorAllowMultipleFiles = Boolean(manualEditorAllowMultipleFiles);
    }
    if (manualEditorFileTypes !== undefined) mergedSubstitutions.manualEditorFileTypes = manualEditorFileTypes;
    if (manualEditorDefaultAction !== undefined) {
      mergedSubstitutions.manualEditorDefaultAction = String(manualEditorDefaultAction);
    }
    if (vectorEditorPath !== undefined) {
      mergedSubstitutions.vectorEditorPath = String(normalizeEditorPathSetting(vectorEditorPath));
    }
    if (vectorEditorAllowMultipleFiles !== undefined) {
      mergedSubstitutions.vectorEditorAllowMultipleFiles = Boolean(vectorEditorAllowMultipleFiles);
    }
    if (vectorEditorFileTypes !== undefined) mergedSubstitutions.vectorEditorFileTypes = vectorEditorFileTypes;
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

    await configureDefaultImportStorageForUser({
      userId: user.id,
      storageRootPath:
        storageRootPath ??
        (mergedSubstitutions.storageRootPath as string | undefined) ??
        DEFAULT_MANAGED_PATHS.storageRootPath,
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
