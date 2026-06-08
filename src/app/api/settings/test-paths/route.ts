/**
 * VectorForge - Test Paths API Route
 * Checks if configured directories exist and are writable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { access, mkdir, constants } from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';

interface PathTestResult {
  path: string;
  exists: boolean;
  writable: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const { paths } = await req.json();

    if (!Array.isArray(paths)) {
      return NextResponse.json({ error: 'paths must be an array' }, { status: 400 });
    }

    const results: PathTestResult[] = [];

    for (const p of paths) {
      // Security: only allow relative paths starting with ./
      if (!p.startsWith('./') || p.includes('..')) {
        results.push({ path: p, exists: false, writable: false, error: 'Invalid path' });
        continue;
      }

      const resolvedPath = path.resolve(process.cwd(), p);

      try {
        await access(resolvedPath, constants.F_OK);
        // Exists, check writable
        try {
          await access(resolvedPath, constants.W_OK);
          results.push({ path: p, exists: true, writable: true });
        } catch {
          results.push({ path: p, exists: true, writable: false, error: 'Not writable' });
        }
      } catch {
        results.push({ path: p, exists: false, writable: false, error: 'Does not exist' });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}