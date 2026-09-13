import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { activateDirectRasterWorkingVersion, listDirectRasterWorkingVersions } from '@/services/raster-editor-preparation';
import { getDirectWorkingRasterState } from '@/services/direct-working-raster';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth(); const { artworkId } = await params;
    const workflow = await getDirectWorkingRasterState({ userId: user.id, artworkId });
    const versions = await listDirectRasterWorkingVersions({ userId: user.id, artworkId });
    return NextResponse.json({ success: true, ...workflow, ...versions });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load raster versions' }, { status: 400 }); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth(); const { artworkId } = await params; const body = await req.json();
    if (typeof body.versionKey !== 'string') return NextResponse.json({ success: false, error: 'A raster version is required' }, { status: 400 });
    return NextResponse.json({ success: true, ...(await activateDirectRasterWorkingVersion({ userId: user.id, artworkId, versionKey: body.versionKey })) });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to activate raster version' }, { status: 400 }); }
}
