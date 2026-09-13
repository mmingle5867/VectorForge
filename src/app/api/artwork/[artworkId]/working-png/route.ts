import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { createDirectWorkingPng } from '@/services/direct-working-raster';

export async function POST(_request: Request, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    return NextResponse.json({ success: true, ...(await createDirectWorkingPng({ userId: user.id, artworkId })) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to create the working PNG' }, { status: 400 });
  }
}
