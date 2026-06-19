import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
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

function getExtendedPath(settingsJson: unknown, key: string, fallback: string) {
  if (settingsJson && typeof settingsJson === 'object' && !Array.isArray(settingsJson)) {
    const value = (settingsJson as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

async function pathExists(filePath: string) {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function mimeTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function issueMessages(issues: Array<{ message: string }>) {
  return issues.map((issue) => issue.message);
}

async function getAuthorizedItem(batchId: string, itemId: string, userId: string) {
  const item = await prisma.batchItem.findUnique({
    where: { id: itemId },
    include: { batch: true },
  });

  if (!item || item.batchId !== batchId || item.batch.userId !== userId) {
    return null;
  }

  return item;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') || 'templates';

    if (mode === 'image') {
      const batchId = getString(searchParams.get('batchId'));
      const itemId = getString(searchParams.get('itemId'));
      const relativePath = getString(searchParams.get('path'));

      if (!batchId || !itemId || !relativePath) {
        return NextResponse.json(
          { success: false, error: 'batchId, itemId, and path are required' },
          { status: 400 }
        );
      }

      if (path.isAbsolute(relativePath) || relativePath.includes('..')) {
        return NextResponse.json({ success: false, error: 'Invalid image path' }, { status: 400 });
      }

      const item = await getAuthorizedItem(batchId, itemId, user.id);
      if (!item || !item.outputFolderPath) {
        return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
      }

      const packageRoot = path.resolve(item.outputFolderPath);
      const imagePath = path.resolve(packageRoot, relativePath);
      if (!imagePath.startsWith(`${packageRoot}${path.sep}`) || !(await pathExists(imagePath))) {
        return NextResponse.json({ success: false, error: 'Image not found' }, { status: 404 });
      }

      const imageBuffer = await readFile(imagePath);
      return new Response(imageBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': mimeTypeFor(imagePath),
          'Cache-Control': 'private, max-age=0, no-store',
        },
      });
    }

    const baseAssetsPath = resolveConfiguredPath(user.settings?.baseAssetsPath || config.paths.baseAssets);
    const templatePath = resolveConfiguredPath(
      getExtendedPath(user.settings?.defaultSubstitutions, 'templatePath', `${user.settings?.baseAssetsPath || config.paths.baseAssets}/templates`)
    );
    const templateResult = await loadCompositeTemplates(baseAssetsPath, templatePath);

    return NextResponse.json({
      success: true,
      templates: templateResult.templates.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description || '',
        assetProfile: template.assetProfile,
        marketplace: template.marketplace,
        outputRole: template.outputRole,
        slot: template.slot || null,
        priority: template.priority || null,
        width: template.width,
        height: template.height,
        format: template.format,
        quality: template.quality || null,
      })),
      warnings: issueMessages(templateResult.warnings),
      errors: issueMessages(templateResult.errors),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load composites' },
      { status: 500 }
    );
  }
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

    const item = await getAuthorizedItem(batchId, itemId, user.id);
    if (!item) {
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

    if (!sourceArtworkPngPath || !(await pathExists(sourceArtworkPngPath))) {
      return NextResponse.json(
        { success: false, error: 'Primary PNG artwork file was not found' },
        { status: 404 }
      );
    }

    const baseAssetsPath = resolveConfiguredPath(user.settings?.baseAssetsPath || config.paths.baseAssets);
    const templatePath = resolveConfiguredPath(
      getExtendedPath(user.settings?.defaultSubstitutions, 'templatePath', `${user.settings?.baseAssetsPath || config.paths.baseAssets}/templates`)
    );
    const templateResult = await loadCompositeTemplates(baseAssetsPath, templatePath);
    const template = templateResult.templates.find((candidate) => candidate.id === templateId);

    if (!template) {
      return NextResponse.json(
        {
          success: false,
          error: `Composite template not found: ${templateId}`,
          warnings: issueMessages(templateResult.warnings),
          errors: issueMessages(templateResult.errors),
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
      warnings: [...issueMessages(templateResult.warnings), ...result.warnings],
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
