import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { approveDirectArtwork } from '@/services/direct-artwork-approval';

export async function POST(req: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try { const user = await requireAuth(); const { artworkId } = await params; const body = await req.json(); return NextResponse.json({ success: true, ...(await approveDirectArtwork({ userId: user.id, artworkId, settings: body.settings ?? {}, upscaleFactor: body.upscaleFactor, candidateId: body.candidateId, reviewStatus: body.reviewStatus })) }); }
  catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to approve artwork' }, { status: 400 }); }
}
