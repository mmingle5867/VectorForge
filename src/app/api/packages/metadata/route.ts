import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { findManifestPath } from '@/lib/output-naming';
import type { ListingMetadata, PackageManifestV2 } from '@/lib/package-manifest-schema';
import {
  appendListingMetadataHistory,
  calculateListingMetadataCompleteness,
  createEmptyListingMetadata,
  normalizeListingMetadata,
} from '@/services/listing-metadata';
import { logger } from '@/lib/logger';

function normalizeRelativePath(baseDir: string, targetPath: string) {
  return path.relative(baseDir, targetPath).split(path.sep).join('/');
}

function isPackageManifest(value: unknown): value is PackageManifestV2 {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as PackageManifestV2).schemaVersion === '2.0' &&
      (value as PackageManifestV2).package &&
      (value as PackageManifestV2).files &&
      (value as PackageManifestV2).listing
  );
}

async function resolvePackageContext(batchId: string, itemId: string, userId: string) {
  const item = await prisma.batchItem.findFirst({
    where: { id: itemId, batchId },
    include: { batch: true },
  });

  if (!item || item.batch.userId !== userId) {
    return null;
  }

  return item;
}

async function readManifest(manifestPath: string) {
  const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as unknown;
  if (!isPackageManifest(parsed)) {
    return null;
  }
  return parsed;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const batchId = req.nextUrl.searchParams.get('batchId')?.trim() || '';
    const itemId = req.nextUrl.searchParams.get('itemId')?.trim() || '';

    if (!batchId || !itemId) {
      return NextResponse.json({ success: false, error: 'batchId and itemId are required' }, { status: 400 });
    }

    const item = await resolvePackageContext(batchId, itemId, user.id);
    if (!item) {
      return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    }

    if (!item.outputFolderPath) {
      return NextResponse.json({ success: false, error: 'Package output folder is missing' }, { status: 400 });
    }

    const manifestPath = await findManifestPath(item.outputFolderPath);
    if (!manifestPath) {
      return NextResponse.json({ success: false, error: 'Package manifest not found' }, { status: 404 });
    }

    const manifest = await readManifest(manifestPath);
    if (!manifest) {
      return NextResponse.json({ success: false, error: 'Unsupported manifest format' }, { status: 400 });
    }

    const listing = manifest.listing || createEmptyListingMetadata();
    const completeness = calculateListingMetadataCompleteness(listing);

    return NextResponse.json({
      success: true,
      manifestPath: normalizeRelativePath(item.outputFolderPath, manifestPath),
      schemaVersion: manifest.schemaVersion,
      canEdit: manifest.schemaVersion === '2.0',
      listing,
      completeness,
      warnings: manifest.schemaVersion === '2.0' ? [] : ['Listing metadata editing requires Manifest V2.'],
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    logger.error('Failed to load package listing metadata', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load package listing metadata' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : '';
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    const listingInput = body.listing && typeof body.listing === 'object' ? body.listing : body;

    if (!batchId || !itemId) {
      return NextResponse.json({ success: false, error: 'batchId and itemId are required' }, { status: 400 });
    }

    const item = await resolvePackageContext(batchId, itemId, user.id);
    if (!item) {
      return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
    }

    if (!item.outputFolderPath) {
      return NextResponse.json({ success: false, error: 'Package output folder is missing' }, { status: 400 });
    }

    const manifestPath = await findManifestPath(item.outputFolderPath);
    if (!manifestPath) {
      return NextResponse.json({ success: false, error: 'Package manifest not found' }, { status: 404 });
    }

    const manifest = await readManifest(manifestPath);
    if (!manifest) {
      return NextResponse.json({ success: false, error: 'Unsupported manifest format' }, { status: 400 });
    }

    if (manifest.schemaVersion !== '2.0') {
      return NextResponse.json(
        {
          success: false,
          error: 'Listing metadata editing requires Manifest V2.',
          warnings: ['This package uses a legacy manifest and cannot be updated from VectorForge yet.'],
        },
        { status: 400 }
      );
    }

    const listing: ListingMetadata = normalizeListingMetadata(listingInput);
    const completeness = calculateListingMetadataCompleteness(listing);
    const now = new Date().toISOString();
    const nextManifest: PackageManifestV2 = {
      ...manifest,
      updatedAt: now,
      listing,
      processingHistory: appendListingMetadataHistory(manifest.processingHistory),
    };

    await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf-8');

    return NextResponse.json({
      success: true,
      manifestPath: normalizeRelativePath(item.outputFolderPath, manifestPath),
      schemaVersion: manifest.schemaVersion,
      canEdit: true,
      listing,
      completeness,
      warnings: [],
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    logger.error('Failed to update package listing metadata', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update package listing metadata' },
      { status: 500 }
    );
  }
}
