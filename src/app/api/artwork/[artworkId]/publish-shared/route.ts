import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { publishArtworkToSharedResources, sharePreview } from '@/services/foundation-resource-publisher';

export async function POST(request: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    const body = await request.json().catch(() => ({}));
    const assetVersionIds = Array.isArray(body.assetVersionIds) && body.assetVersionIds.every((value: unknown) => typeof value === 'string')
      ? body.assetVersionIds as string[] : undefined;
    const description = typeof body.description === 'string' ? body.description : undefined;
    return NextResponse.json({ success: true, ...(await publishArtworkToSharedResources({ artworkId, userId: user.id, assetVersionIds, description })) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to publish resources to Foundation Resource' }, { status: 400 });
  }
}

/** The description and categories a share of this artwork would carry, to show and edit before publishing. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    return NextResponse.json({ success: true, ...(await sharePreview({ artworkId, userId: user.id })) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to read what would be shared' }, { status: 400 });
  }
}
