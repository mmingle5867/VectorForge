import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { splitArtwork, splitDirectArtwork } from '@/services/artwork-split';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const user = await requireAuth();
    const { itemId } = await params;
    const body = await req.json();
    const directArtwork = await prisma.artwork.findFirst({
      where: { id: itemId, userId: user.id, status: 'ACTIVE', batchItems: { none: {} } },
      select: { id: true },
    });
    const result = directArtwork
      ? await splitDirectArtwork({ userId: user.id, artworkId: directArtwork.id, childNames: Array.isArray(body.childNames) ? body.childNames : [] })
      : await splitArtwork({ userId: user.id, batchItemId: itemId, childNames: Array.isArray(body.childNames) ? body.childNames : [] });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to split artwork' }, { status: 400 });
  }
}
