import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { batchRenameDirectArtwork } from '@/services/direct-artwork-actions';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const artworkIds: string[] = Array.isArray(body.artworkIds)
      ? (body.artworkIds as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    const baseName = typeof body.baseName === 'string' ? body.baseName : '';
    const result = await batchRenameDirectArtwork({ userId: user.id, artworkIds, newBaseName: baseName });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to rename selected artwork' },
      { status: 400 },
    );
  }
}
