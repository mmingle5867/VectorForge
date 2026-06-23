import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { DEFAULT_MANAGED_PATHS, resolveManagedPath } from '@/lib/path-management';
import { discoverBundles } from '@/services/bundle-discovery';

function getExtendedPath(settingsJson: Record<string, unknown>, key: string, fallback: string) {
  const value = settingsJson[key];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return fallback;
}

export async function GET() {
  try {
    const user = await requireAuth();
    const settings = user.settings;
    const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const bundleOutputPath = resolveManagedPath(
      getExtendedPath(
        settingsJson,
        'bundleOutputPath',
        DEFAULT_MANAGED_PATHS.bundleOutputPath
      )
    );

    const result = await discoverBundles(bundleOutputPath);

    return NextResponse.json({
      success: true,
      bundleOutputPath,
      bundles: result.bundles,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to discover bundles' },
      { status: 500 }
    );
  }
}
