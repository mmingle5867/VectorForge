import { NextResponse } from 'next/server';
import { access, readFile } from 'fs/promises';
import { requireAuth } from '@/lib/auth';
import { findManifestPath } from '@/lib/output-naming';
import prisma from '@/lib/prisma';

async function fileExists(filePath: string | null | undefined) {
  if (!filePath) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET() {
  try {
    const user = await requireAuth();

    const batches = await prisma.batch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        items: {
          orderBy: { sequenceNumber: 'asc' },
          select: {
            id: true,
            originalFilename: true,
            baseName: true,
            status: true,
            outputFolderPath: true,
            artworkId: true,
            assetProfileId: true,
            artworkNumber: true,
            profileNumber: true,
          },
        },
      },
    });

    const completedItems = batches.flatMap((batch) =>
      batch.items
        .filter((item) => item.status === 'COMPLETED' && item.outputFolderPath)
        .map((item) => ({ batch, item }))
    );

    const packages = await Promise.all(
      completedItems.map(async ({ batch, item }) => {
        const outputFolderPath = item.outputFolderPath!;
        const manifestPath = await findManifestPath(outputFolderPath);
        const manifestExists = await fileExists(manifestPath);

        if (!manifestPath || !manifestExists) {
          return {
            batchId: batch.id,
            batchName: batch.name,
            batchStatus: batch.status,
            itemId: item.id,
            itemStatus: item.status,
            originalFilename: item.originalFilename,
            baseName: item.baseName,
            outputFolderPath,
            manifestPath: null,
            packageId: item.artworkNumber && item.profileNumber ? `PKG-${item.artworkNumber}-${item.profileNumber}` : '',
            artworkId: item.artworkId || '',
            profileId: item.profileNumber || item.assetProfileId || '',
            title: item.baseName,
            packageType: '',
            readiness: 'Missing manifest',
            warnings: ['Manifest file not found'],
            errors: ['Manifest file not found'],
          };
        }

        let manifest: unknown = null;
        try {
          manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
        } catch {
          return {
            batchId: batch.id,
            batchName: batch.name,
            batchStatus: batch.status,
            itemId: item.id,
            itemStatus: item.status,
            originalFilename: item.originalFilename,
            baseName: item.baseName,
            outputFolderPath,
            manifestPath,
            packageId: item.artworkNumber && item.profileNumber ? `PKG-${item.artworkNumber}-${item.profileNumber}` : '',
            artworkId: item.artworkId || '',
            profileId: item.profileNumber || item.assetProfileId || '',
            title: item.baseName,
            packageType: '',
            readiness: 'Invalid manifest',
            warnings: [],
            errors: ['Manifest could not be parsed'],
          };
        }

        const manifestRecord = readObject(manifest);
        const packageSection = readObject(manifestRecord.package);
        const bundleSection = readObject(manifestRecord.bundle);
        const artworkSection = readObject(manifestRecord.artwork);
        const readinessSection = readObject(manifestRecord.readiness);
        const packageId = readString(packageSection.packageId);
        const packageType = readString(packageSection.packageType);
        const title =
          readString(bundleSection.title) ||
          readString(artworkSection.title) ||
          item.baseName;
        const errors = Array.isArray(manifestRecord.errors)
          ? (manifestRecord.errors as string[])
          : [];
        const warnings = Array.isArray(manifestRecord.warnings)
          ? (manifestRecord.warnings as string[])
          : [];

        return {
          batchId: batch.id,
          batchName: batch.name,
          batchStatus: batch.status,
          itemId: item.id,
          itemStatus: item.status,
          originalFilename: item.originalFilename,
          baseName: item.baseName,
          outputFolderPath,
          manifestPath,
          packageId,
          artworkId: item.artworkId || '',
          profileId: item.profileNumber || item.assetProfileId || '',
          title,
          packageType,
          readiness:
            typeof readinessSection.readyForListingTool === 'boolean'
              ? readinessSection.readyForListingTool
              : item.status,
          warnings,
          errors,
        };
      })
    );

    return NextResponse.json({
      success: true,
      packages: packages.filter((pkg) => Boolean(pkg.outputFolderPath)),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load bundle sources' },
      { status: 500 }
    );
  }
}
