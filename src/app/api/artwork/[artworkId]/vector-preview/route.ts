import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { generateDirectArtworkVectorPreview, readDirectArtworkVectorPreview, renderDirectArtworkVectorPreview } from '@/services/direct-artwork-vector-preview';

export async function POST(req: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    const body = await req.json();
    const result = await generateDirectArtworkVectorPreview({ userId: user.id, artworkId, settings: body.settings ?? {}, upscaleFactor: body.upscaleFactor });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to generate vector preview' }, { status: 400 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    const candidateId = new URL(req.url).searchParams.get('candidateId') || '';
    const format = new URL(req.url).searchParams.get('format');
    if (format === 'png' || format === 'jpg') {
      const raster = await renderDirectArtworkVectorPreview({
        userId: user.id,
        artworkId,
        candidateId,
        format,
        preserveColors: new URL(req.url).searchParams.get('colorMode') === 'color',
      });
      return new NextResponse(raster as unknown as BodyInit, {
        headers: {
          'content-type': format === 'png' ? 'image/png' : 'image/jpeg',
          'cache-control': 'no-store',
        },
      });
    }
    const svg = await readDirectArtworkVectorPreview({ userId: user.id, artworkId, candidateId });
    return new NextResponse(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Vector preview unavailable' }, { status: 404 });
  }
}
