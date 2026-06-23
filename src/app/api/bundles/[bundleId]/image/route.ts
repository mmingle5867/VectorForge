import { NextRequest, NextResponse } from 'next/server';
import { access, readFile } from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import { DEFAULT_MANAGED_PATHS, resolveManagedPath } from '@/lib/path-management';
import { loadBundleById } from '@/services/bundle-discovery';

function getExtendedPath(settingsJson: Record<string, unknown>, key: string, fallback: string) {
  const value = settingsJson[key];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return fallback;
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function mimeTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bundleId: string }> }
) {
  try {
    const user = await requireAuth();
    const { bundleId } = await params;
    const { searchParams } = new URL(req.url);
    const relativePath = getString(searchParams.get('path'));

    if (!relativePath) {
      return NextResponse.json({ success: false, error: 'path is required' }, { status: 400 });
    }

    if (path.isAbsolute(relativePath) || relativePath.includes('..')) {
      return NextResponse.json({ success: false, error: 'Invalid image path' }, { status: 400 });
    }

    const settings = user.settings;
    const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
    const bundleOutputPath = resolveManagedPath(
      getExtendedPath(
        settingsJson,
        'bundleOutputPath',
        DEFAULT_MANAGED_PATHS.bundleOutputPath
      )
    );

    const bundle = await loadBundleById(bundleOutputPath, bundleId);
    if (!bundle) {
      return NextResponse.json({ success: false, error: 'Bundle not found' }, { status: 404 });
    }

    const bundleRoot = bundle.bundleFolderPath;
    const imagePath = path.resolve(bundleRoot, relativePath);
    const relativeCheck = path.relative(bundleRoot, imagePath);

    if (!relativeCheck || relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
      return NextResponse.json({ success: false, error: 'Image path is outside the bundle folder' }, { status: 400 });
    }

    if (!(await pathExists(imagePath))) {
      return NextResponse.json({ success: false, error: 'Image not found' }, { status: 404 });
    }

    const imageBuffer = await readFile(imagePath);
    return new Response(imageBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': mimeTypeFor(imagePath),
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load bundle image' },
      { status: 500 }
    );
  }
}
