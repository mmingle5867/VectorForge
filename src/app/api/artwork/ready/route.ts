import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { READY_VECTOR_ARTWORK_CAPABILITY, listReadyVectorArtworkForConsumer } from '@/services/vectorforge-artwork-readiness';

/**
 * Cross-application read endpoint. It returns only artwork with a saved,
 * approved SVG vector output. The caller's normal VectorForge user boundary
 * remains in effect; broader sharing policy will be added with SEMA access.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    const artwork = await listReadyVectorArtworkForConsumer(user.id);
    return NextResponse.json({ success: true, capability: READY_VECTOR_ARTWORK_CAPABILITY, artwork });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to list ready artwork' }, { status: 500 });
  }
}
