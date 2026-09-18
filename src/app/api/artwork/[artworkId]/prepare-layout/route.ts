import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { prepareDirectRasterLayout, type CanvasAnchor, type RasterLayout } from '@/services/direct-raster-layout';

const ANCHORS = new Set<CanvasAnchor>(['TOP_LEFT', 'TOP', 'TOP_RIGHT', 'LEFT', 'CENTER', 'RIGHT', 'BOTTOM_LEFT', 'BOTTOM', 'BOTTOM_RIGHT']);

function layoutFrom(value: unknown): RasterLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Raster preparation settings are required');
  const input = value as Record<string, unknown>;
  const integer = (key: string) => {
    const number = Number(input[key]);
    if (!Number.isInteger(number) || number < 1 || number > 200000) throw new Error(`${key} must be a whole number between 1 and 200000`);
    return number;
  };
  const blur = Number(input.blur);
  const imageDpi = Number(input.imageDpi);
  const canvasDpi = Number(input.canvasDpi);
  const anchor = typeof input.anchor === 'string' && ANCHORS.has(input.anchor as CanvasAnchor) ? input.anchor as CanvasAnchor : null;
  const fill = input.fill === 'BLACK' ? 'BLACK' : input.fill === 'WHITE' ? 'WHITE' : null;
  if (!Number.isFinite(blur) || blur < 0 || blur > 20 || ![imageDpi, canvasDpi].every((dpi) => Number.isFinite(dpi) && dpi >= 1 && dpi <= 2400) || !anchor || !fill) {
    throw new Error('Invalid raster preparation settings');
  }
  return { blur, imageDpi, canvasDpi, anchor, fill, imageWidth: integer('imageWidth'), imageHeight: integer('imageHeight'), canvasWidth: integer('canvasWidth'), canvasHeight: integer('canvasHeight') };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    const body = await request.json();
    const result = await prepareDirectRasterLayout({ userId: user.id, artworkId, layout: layoutFrom(body.layout) });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to prepare working JPG';
    return NextResponse.json({ success: false, error: message }, { status: message === 'Unauthorized' ? 401 : 400 });
  }
}
