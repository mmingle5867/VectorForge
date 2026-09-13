import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { scanArtworkDirectProcessingFolder } from '@/services/artwork-direct-ingest';

export async function POST() {
  try {
    const user = await requireAuth();
    const result = await scanArtworkDirectProcessingFolder(user.id);
    return NextResponse.json({
      success: true,
      imported: result?.files.length ?? 0,
      files: result?.files ?? [],
      errors: result?.errors ?? [],
      storage: result?.storage ?? null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Folder scan failed' },
      { status: 500 }
    );
  }
}
