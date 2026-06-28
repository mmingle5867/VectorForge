import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  deleteAssetBundleRelationship,
  loadAssetBundleRelationship,
} from '@/services/bundle-relationships';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> }
) {
  try {
    const user = await requireAuth();
    const { bundleId } = await params;

    const bundle = await loadAssetBundleRelationship(user.id, bundleId);

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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> }
) {
  try {
    const user = await requireAuth();
    const { bundleId } = await params;
    const deleted = await deleteAssetBundleRelationship(user.id, bundleId);

    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Bundle not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      bundleId,
      assetsDeleted: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete bundle' },
      { status: 500 }
    );
  }
}
