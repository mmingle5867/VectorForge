/**
 * VectorForge - Create Default Directories API Route
 * Creates the standard project directories if they don't exist.
 */

import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  DEFAULT_MANAGED_PATHS,
  resolveManagedPath,
  validateManagedPathValue,
} from '@/lib/path-management';

const DEFAULT_DIRS = [
  DEFAULT_MANAGED_PATHS.workingPath,
  DEFAULT_MANAGED_PATHS.uploadPath,
  DEFAULT_MANAGED_PATHS.outputPath,
  DEFAULT_MANAGED_PATHS.bundleOutputPath,
  DEFAULT_MANAGED_PATHS.archivePath,
  DEFAULT_MANAGED_PATHS.baseAssetsPath,
  DEFAULT_MANAGED_PATHS.templatePath,
  './logs',
];

function openFolder(folderPath: string) {
  if (process.platform === 'win32') {
    spawn('explorer.exe', [folderPath], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'darwin') {
    spawn('open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : 'create-defaults';
    const requestedPath = typeof body.path === 'string' ? body.path : '';

    const results = [];
    const dirs = action === 'create' || action === 'open' ? [requestedPath] : DEFAULT_DIRS;

    for (const dir of dirs) {
      const validationError = validateManagedPathValue(dir);
      if (validationError) {
        results.push({ path: dir, created: false, error: validationError });
        continue;
      }

      const resolvedPath = resolveManagedPath(dir);
      try {
        await mkdir(resolvedPath, { recursive: true });
        if (action === 'open') {
          openFolder(resolvedPath);
        }
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
    if (action === 'create-defaults') {
      const baseAssetsReadme = path.join(resolveManagedPath(DEFAULT_MANAGED_PATHS.baseAssetsPath), 'README.md');
      try {
        await writeFile(
          baseAssetsReadme,
          `# Base Assets\n\nPlace reusable backgrounds, watermarks, overlays, icons, and templates here.\n`,
          { flag: 'wx' }
        );
      } catch {
        // File already exists, ignore
      }
    }

    logger.info('Settings path action completed', { action, results });

    return NextResponse.json({ success: true, results });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
