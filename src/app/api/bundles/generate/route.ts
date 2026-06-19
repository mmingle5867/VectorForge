import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import { logger } from '@/lib/logger';
import { DEFAULT_MANAGED_PATHS, resolveManagedPath } from '@/lib/path-management';
import { createBundlePlan } from '@/services/bundle-planner';
import { generateBundlePackage } from '@/services/bundle-generator';

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getTemplateVariables(settingsJson: Record<string, unknown>) {
  const variables: Record<string, string> = {};

  for (const [key, value] of Object.entries(settingsJson)) {
    if (typeof value === 'string') {
      variables[key] = value;
    }
  }

  if (
    settingsJson.templateVariables &&
    typeof settingsJson.templateVariables === 'object' &&
    !Array.isArray(settingsJson.templateVariables)
  ) {
    for (const [key, value] of Object.entries(settingsJson.templateVariables)) {
      variables[key] = typeof value === 'string' ? value : String(value ?? '');
    }
  }

  return variables;
}

function getExtendedPath(settingsJson: Record<string, unknown>, key: string, fallback: string) {
  const value = settingsJson[key];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return fallback;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const bundleTitle = getString(body.bundleTitle);
    const bundleId = getString(body.bundleId) || undefined;
    const bundleNotes = getString(body.bundleNotes);
    const memberManifestPaths = Array.isArray(body.memberManifestPaths)
      ? (body.memberManifestPaths as unknown[]).filter(
          (value): value is string => typeof value === 'string'
        )
      : [];

    if (!bundleTitle) {
      return NextResponse.json(
        { success: false, error: 'bundleTitle is required' },
        { status: 400 }
      );
    }

    if (memberManifestPaths.length === 0) {
      return NextResponse.json(
        { success: false, error: 'memberManifestPaths is required' },
        { status: 400 }
      );
    }

    const settings = user.settings;
    const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const baseAssetsPath = resolveManagedPath(settings?.baseAssetsPath || config.paths.baseAssets);
    const bundleOutputPath = resolveManagedPath(
      getExtendedPath(
        settingsJson,
        'bundleOutputPath',
        DEFAULT_MANAGED_PATHS.bundleOutputPath
      )
    );
    const templateRoot = resolveManagedPath(
      getExtendedPath(
        settingsJson,
        'templatePath',
        `${settings?.baseAssetsPath || config.paths.baseAssets}/templates`
      )
    );

    const plan = await createBundlePlan({
      bundleTitle,
      bundleId,
      memberPackages: memberManifestPaths.map((manifestPath) => ({ manifestPath })),
    });

    if (plan.errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          errors: plan.errors,
          warnings: plan.warnings,
          plan,
        },
        { status: 400 }
      );
    }

    const result = await generateBundlePackage({
      plan,
      bundleOutputPath,
      baseAssetsPath,
      documentSettings: {
        companyName: (settingsJson.companyName as string) ?? '',
        contactName: (settingsJson.contactName as string) ?? '',
        website: (settingsJson.website as string) ?? '',
        email: (settingsJson.email as string) ?? '',
        phone: (settingsJson.phone as string) ?? '',
        supportUrl: (settingsJson.supportUrl as string) ?? '',
        defaultLicenseType: (settingsJson.defaultLicenseType as string) ?? '',
        templatePath: templateRoot,
        templateVariables: {
          ...getTemplateVariables(settingsJson),
          ...(bundleNotes ? { BUNDLE_NOTES: bundleNotes } : {}),
        },
      },
    });

    if (!result.success) {
      logger.warn('Bundle generation failed', {
        bundleId: plan.bundleId,
        errors: result.errors,
        warnings: result.warnings,
      });
      return NextResponse.json(
        {
          ...result,
          success: false,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      bundleFolderPath: result.bundleFolderPath,
      manifestPath: result.manifestPath,
      readmePath: result.readmePath,
      licensePath: result.licensePath,
      zipPath: result.zipPath,
      warnings: result.warnings,
      errors: result.errors,
      plan,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    logger.error('Bundle generation route failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Bundle generation failed' },
      { status: 500 }
    );
  }
}
