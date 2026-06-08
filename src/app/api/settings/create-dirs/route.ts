/**
 * VectorForge - Create Default Directories API Route
 * Creates the standard project directories if they don't exist.
 */

import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';

const DEFAULT_DIRS = ['./uploads', './output', './base-assets', './logs'];

export async function POST() {
  try {
    await requireAuth();

    const results = [];

    for (const dir of DEFAULT_DIRS) {
      const resolvedPath = path.resolve(process.cwd(), dir);
      try {
        await mkdir(resolvedPath, { recursive: true });
        results.push({ path: dir, created: true });
      } catch (error) {
        results.push({
          path: dir,
          created: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Create a README in base-assets if it was just created
    const baseAssetsReadme = path.resolve(process.cwd(), './base-assets/README.md');
    try {
      await writeFile(
        baseAssetsReadme,
        `# Base Assets\n\nPlace fallback template files here (video.mp4, images, etc.).\nThese will be copied to output folders when not provided per-batch.\n`,
        { flag: 'wx' } // Only write if doesn't exist
      );
    } catch {
      // File already exists, ignore
    }

    logger.info('Default directories created', { results });

    return NextResponse.json({ success: true, results });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}