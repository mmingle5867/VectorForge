import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { DEFAULT_MANAGED_PATHS, resolveManagedPath } from '@/lib/path-management';
import { loadBundleById } from '@/services/bundle-discovery';

function getExtendedPath(settingsJson: Record<string, unknown>, key: string, fallback: string) {
  const value = settingsJson[key];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return fallback;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> }
) {
  try {
    const user = await requireAuth();
    const { bundleId } = await params;
    const settings = user.settings;
    const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const bundleOutputPath = resolveManagedPath(
      getExtendedPath(
        settingsJson,
        'bundleOutputPath',
        DEFAULT_MANAGED_PATHS.bundleOutputPath
      )
    );

    const bundle = await loadBundleById(bundleOutputPath, bundleId);

    if (!bundle) {
      return NextResponse.json({ success: false, error: 'Bundle not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, bundle });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load bundle' },
      { status: 500 }
    );
  }
}
