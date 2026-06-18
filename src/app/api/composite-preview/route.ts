import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { findExistingNamedFilePath, getPackageBaseName } from '@/lib/output-naming';
import { loadCompositeTemplates } from '@/services/composite-template-loader';
import { renderCompositeTemplate } from '@/services/composite-renderer';

function resolveConfiguredPath(configuredPath: string) {
  return path.resolve(process.cwd(), configuredPath);
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const batchId = getString(body.batchId);
    const itemId = getString(body.itemId);
    const templateId = getString(body.templateId);

    if (!batchId || !itemId || !templateId) {
      return NextResponse.json(
        { success: false, error: 'batchId, itemId, and templateId are required' },
        { status: 400 }
      );
    }

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item || item.batchId !== batchId || item.batch.userId !== user.id) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    if (!item.outputFolderPath) {
      return NextResponse.json(
        { success: false, error: 'Item does not have a saved output folder yet' },
        { status: 400 }
      );
    }

    const packageRoot = path.resolve(item.outputFolderPath);
    const packageBaseName = getPackageBaseName(packageRoot);
    const sourceArtworkPngPath = await findExistingNamedFilePath(
      packageRoot,
      [item.baseName, packageBaseName],
      '.png'
    );

    if (!sourceArtworkPngPath) {
      return NextResponse.json(
        { success: false, error: 'Primary PNG artwork file was not found' },
        { status: 404 }
      );
    }

    const baseAssetsPath = resolveConfiguredPath(user.settings?.baseAssetsPath || config.paths.baseAssets);
    const templateResult = await loadCompositeTemplates(baseAssetsPath);
    const template = templateResult.templates.find((candidate) => candidate.id === templateId);

    if (!template) {
      return NextResponse.json(
        {
          success: false,
          error: `Composite template not found: ${templateId}`,
          warnings: templateResult.warnings,
          errors: templateResult.errors,
        },
        { status: 404 }
      );
    }

    const result = await renderCompositeTemplate({
      template,
      packageRoot,
      sourceArtworkPngPath,
      baseAssetsPath,
      substitutions: {
        ARTWORK_ID: item.artworkNumber || '',
        PROFILE_ID: item.profileNumber || '',
        SKU: item.profileNumber || '',
        PRODUCT_NAME: item.baseName,
        PROFILE_TYPE: template.assetProfile,
      },
    });

    return NextResponse.json({
      success: true,
      outputPath: result.outputPath,
      warnings: [...templateResult.warnings, ...result.warnings],
      metadata: result.metadata,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Composite preview failed',
      },
      { status: 500 }
    );
  }
}
