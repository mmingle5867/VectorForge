import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import { DEFAULT_MANAGED_PATHS, resolveManagedPath } from '@/lib/path-management';
import { createBundlePlan } from '@/services/bundle-planner';
import { generateBundlePackage } from '@/services/bundle-generator';
import { loadBundleById } from '@/services/bundle-discovery';

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getExtendedPath(settingsJson: Record<string, unknown>, key: string, fallback: string) {
  const value = settingsJson[key];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return fallback;
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> }
) {
  try {
    const user = await requireAuth();
    const { bundleId } = await params;
    const body = await req.json().catch(() => ({}));
    const overrideTitle = getString(body.bundleTitle);
    const settings = user.settings;
    const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const bundleOutputPath = resolveManagedPath(
      getExtendedPath(
        settingsJson,
        'bundleOutputPath',
        DEFAULT_MANAGED_PATHS.bundleOutputPath
      )
    );
    const baseAssetsPath = resolveManagedPath(settings?.baseAssetsPath || config.paths.baseAssets);
    const templateRoot = resolveManagedPath(
      getExtendedPath(
        settingsJson,
        'templatePath',
        `${settings?.baseAssetsPath || config.paths.baseAssets}/templates`
      )
    );

    const bundle = await loadBundleById(bundleOutputPath, bundleId);
    if (!bundle) {
      return NextResponse.json({ success: false, error: 'Bundle not found' }, { status: 404 });
    }

    const memberManifestPaths = bundle.manifest.members?.map((member) =>
      path.resolve(path.dirname(bundle.manifestPath), member.sourceManifestPath)
    );

    if (!memberManifestPaths || memberManifestPaths.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Bundle manifest does not include source member manifests' },
        { status: 400 }
      );
    }

    const plan = await createBundlePlan({
      bundleTitle: overrideTitle || bundle.title,
      bundleId: bundle.bundleId,
      memberPackages: memberManifestPaths.map((manifestPath) => ({ manifestPath })),
    });

    if (plan.errors.length > 0) {
      return NextResponse.json(
        { success: false, errors: plan.errors, warnings: plan.warnings, plan },
        { status: 400 }
      );
    }

    await fs.rm(bundle.bundleFolderPath, { recursive: true, force: true });

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
        },
      },
    });

    if (!result.success) {
      return NextResponse.json({ ...result, success: false }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      bundleId: result.bundleId,
      bundleFolderPath: result.bundleFolderPath,
      manifestPath: result.manifestPath,
      readmePath: result.readmePath,
      licensePath: result.licensePath,
      zipPath: result.zipPath,
      warnings: result.warnings,
      errors: result.errors,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to regenerate bundle' },
      { status: 500 }
    );
  }
}
