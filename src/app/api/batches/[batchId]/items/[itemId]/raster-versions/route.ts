import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import {
  activateRasterWorkingVersion,
  listRasterWorkingVersions,
  readRasterWorkingVersionPreview,
} from '@/services/raster-editor-preparation';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;
    const previewKey = req.nextUrl.searchParams.get('previewKey');
    if (previewKey) {
      const preview = await readRasterWorkingVersionPreview({ userId: user.id, batchId, itemId, versionKey: previewKey });
      const extension = preview.filePath.split('.').pop()?.toLowerCase();
      const contentType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif' : 'image/jpeg';
      return new NextResponse(preview.content, { headers: { 'content-type': contentType, 'cache-control': 'no-store' } });
    }
    return NextResponse.json({
      success: true,
      ...(await listRasterWorkingVersions({ userId: user.id, batchId, itemId })),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to load raster versions' },
      { status: error instanceof Error && error.message === 'Unauthorized' ? 401 : 400 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;
    const body = await req.json();
    const versionKey = typeof body.versionKey === 'string' ? body.versionKey : '';
    if (!versionKey) {
      return NextResponse.json({ success: false, error: 'A raster version is required' }, { status: 400 });
    }
    const result = await activateRasterWorkingVersion({ userId: user.id, batchId, itemId, versionKey });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to activate raster version' },
      { status: error instanceof Error && error.message === 'Unauthorized' ? 401 : 400 }
    );
  }
}
