import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { exportDirectArtworkRasterOutputs } from '@/services/direct-raster-output';
import type { RasterOutputSpecification } from '@/services/raster-output';

function parseSpecification(value: unknown): RasterOutputSpecification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('An output specification is required');
  const input = value as Record<string, unknown>;
  const constrainBy = input.constrainBy === 'HEIGHT' ? 'HEIGHT' : input.constrainBy === 'WIDTH' ? 'WIDTH' : null;
  const unit = input.unit === 'MM' ? 'MM' : input.unit === 'IN' ? 'IN' : null;
  const numeric = (name: string, min: number, max: number) => {
    const result = Number(input[name]);
    if (!Number.isFinite(result) || result < min || result > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return result;
  };
  const formats = Array.isArray(input.formats)
    ? [...new Set(input.formats.filter((format): format is 'JPG' | 'PNG' | 'PNG_MASK' | 'PDF' => format === 'JPG' || format === 'PNG' || format === 'PNG_MASK' || format === 'PDF'))]
    : [];
  if (!constrainBy || !unit || formats.length === 0) throw new Error('Choose a dimension, unit, and at least one output format');
  return { constrainBy, unit, value: numeric('value', 0.01, 1000), dpi: numeric('dpi', 1, 2400), formats };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const user = await requireAuth();
    const { itemId } = await params;
    const body = await request.json();
    if (body?.action !== 'export-raster') return NextResponse.json({ success: false, error: 'Unsupported action' }, { status: 400 });
    const result = await exportDirectArtworkRasterOutputs({
      userId: user.id,
      artworkId: itemId,
      specification: parseSpecification(body.specification),
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create output files';
    return NextResponse.json({ success: false, error: message }, { status: message === 'Unauthorized' ? 401 : 400 });
  }
}
