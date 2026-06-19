import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { generateListingMedia } from '@/services/listing-media-generator';
import { updateListingMediaManifest } from '@/services/listing-media-manifest';

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
    : [];
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const batchId = getString(body.batchId);
    const itemId = getString(body.itemId);
    const templateIds = getStringArray(body.templateIds);
    const marketplace = getString(body.marketplace);
    const assetProfile = getString(body.assetProfile);
    const overwrite = Boolean(body.overwrite);

    if (!batchId || !itemId) {
      return NextResponse.json(
        { success: false, error: 'batchId and itemId are required' },
        { status: 400 }
      );
    }

    const result = await generateListingMedia({
      batchId,
      itemId,
      templateIds,
      marketplace: marketplace || undefined,
      assetProfile: assetProfile || undefined,
      overwrite,
      userId: user.id,
    });

    let manifestUpdated = false;
    let manifestPath: string | null = null;
    const manifestWarnings: string[] = [];
    const manifestErrors: string[] = [];

    if (result.success && result.packageRoot) {
      const manifestResult = await updateListingMediaManifest({
        packageRoot: result.packageRoot,
        batchId,
        itemId,
        generated: result.generated,
        skipped: result.skipped,
        templateIds,
        marketplace: marketplace || undefined,
        assetProfile: assetProfile || undefined,
        overwrite,
      });

      manifestUpdated = manifestResult.manifestUpdated;
      manifestPath = manifestResult.manifestPath;
      manifestWarnings.push(...manifestResult.warnings);
      manifestErrors.push(...manifestResult.errors);
    }

    const mergedWarnings = [...result.warnings, ...manifestWarnings];
    const mergedErrors = [...result.errors, ...manifestErrors];

    if (!result.success && result.generated.length === 0 && result.skipped.length === 0) {
      return NextResponse.json(
        {
          ...result,
          warnings: mergedWarnings,
          errors: mergedErrors,
          manifestUpdated,
          manifestPath,
          success: false,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ...result,
      warnings: mergedWarnings,
      errors: mergedErrors,
      manifestUpdated,
      manifestPath,
      success: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    logger.error('Listing media generation failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Listing media generation failed' },
      { status: 500 }
    );
  }
}
