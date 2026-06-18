/**
 * VectorForge - Test Paths API Route
 * Checks if configured directories exist and are writable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { access, constants } from 'fs/promises';
import { requireAuth } from '@/lib/auth';
import {
  hasCloudStorageSegment,
  resolveManagedPath,
  validateManagedPathValue,
  type ManagedPathType,
} from '@/lib/path-management';

interface PathTestResult {
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  cloudStorage: boolean;
  warning?: string;
  error?: string;
  type?: ManagedPathType;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const { paths } = await req.json();

    if (!Array.isArray(paths)) {
      return NextResponse.json({ error: 'paths must be an array' }, { status: 400 });
    }

    const results: PathTestResult[] = [];

    for (const entry of paths) {
      const p = typeof entry === 'string' ? entry : String(entry?.path || '');
      const type = typeof entry === 'object' && entry?.type ? String(entry.type) as ManagedPathType : undefined;
      const validationError = validateManagedPathValue(p);
      const cloudStorage = hasCloudStorageSegment(p);
      const warning =
        type === 'workingPath' && cloudStorage
          ? 'Cloud-synced working folders may reduce performance.'
          : undefined;

      if (validationError) {
        results.push({
          path: p,
          type,
          exists: false,
          readable: false,
          writable: false,
          cloudStorage,
          warning,
          error: validationError,
        });
        continue;
      }

      const resolvedPath = resolveManagedPath(p);

      try {
        await access(resolvedPath, constants.F_OK);
        let readable = false;
        let writable = false;

        try {
          await access(resolvedPath, constants.R_OK);
          readable = true;
        } catch {
          // handled below
        }
        try {
          await access(resolvedPath, constants.W_OK);
          writable = true;
        } catch {
          // handled below
        }

        results.push({
          path: p,
          type,
          exists: true,
          readable,
          writable,
          cloudStorage,
          warning,
          error: readable && writable ? undefined : readable ? 'Not writable' : 'Not readable',
        });
      } catch {
        results.push({
          path: p,
          type,
          exists: false,
          readable: false,
          writable: false,
          cloudStorage,
          warning,
          error: 'Does not exist',
        });
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
