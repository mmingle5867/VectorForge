import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listAssetBundleRelationships } from '@/services/bundle-relationships';

export async function GET() {
  try {
    const user = await requireAuth();
    const bundles = await listAssetBundleRelationships(user.id);

    return NextResponse.json({
      success: true,
      bundles,
      warnings: [],
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
