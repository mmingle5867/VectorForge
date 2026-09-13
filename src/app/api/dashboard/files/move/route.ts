import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { moveArtworkBatch } from '@/services/artwork-move';

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const batchItemIds = Array.isArray(body.batchItemIds)
      ? body.batchItemIds.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const destinationRootPath = typeof body.destinationRootPath === 'string' ? body.destinationRootPath.trim() : '';
    if (batchItemIds.length === 0) return NextResponse.json({ success: false, error: 'Select at least one artwork file' }, { status: 400 });
    if (!destinationRootPath) return NextResponse.json({ success: false, error: 'Enter a destination storage root' }, { status: 400 });

    const results = await moveArtworkBatch({
      userId: user.id,
      batchItemIds,
      destinationRootPath,
      makeDefaultImport: body.makeDefaultImport === true,
    });
    const moved = results.filter((entry) => entry.success && entry.result.changed).length;
    const failures = results.filter((entry) => !entry.success);
    return NextResponse.json({
      success: failures.length === 0,
      moved,
      failed: failures.length,
      error: failures.length ? failures.map((entry) => `${entry.batchItemId}: ${entry.error}`).join('; ') : undefined,
      results,
    });
  } catch (error) {
    logger.error('Artwork move failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to move artwork' },
      { status: 500 }
    );
  }
}
