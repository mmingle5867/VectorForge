import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import prisma from '@/lib/prisma';
import config from '@/lib/config';
import { findExistingNamedFilePath, getPackageBaseName } from '@/lib/output-naming';
import { getProfileListingImagesDir } from '@/lib/package-structure';
import {
  type CompositeTemplate,
} from '@/lib/composite-template-schema';
import { loadCompositeTemplates } from '@/services/composite-template-loader';
import {
  renderCompositeTemplate,
  resolveCompositeRenderOutputPath,
  type CompositeRenderMetadata,
} from '@/services/composite-renderer';

export type ListingMediaGeneratorInput = {
  batchId: string;
  itemId: string;
  templateIds?: string[];
  marketplace?: string;
  assetProfile?: string;
  overwrite?: boolean;
  userId?: string;
  baseAssetsPath?: string;
  templatePath?: string;
};

export type ListingMediaGeneratedItem = {
  templateId: string;
  templateName: string;
  outputPath: string;
  metadata: CompositeRenderMetadata;
  warnings: string[];
};

export type ListingMediaSkippedItem = {
  templateId: string;
  templateName: string;
  outputPath: string;
  reason: string;
  metadata?: CompositeRenderMetadata;
  warnings: string[];
};

export type ListingMediaGenerationResult = {
  success: boolean;
  batchId: string;
  itemId: string;
  packageRoot: string | null;
  selectedTemplates: string[];
  generated: ListingMediaGeneratedItem[];
  skipped: ListingMediaSkippedItem[];
  warnings: string[];
  errors: string[];
};

type LoadedItemContext = {
  packageRoot: string;
  sourceArtworkPngPath: string;
  baseName: string;
  artworkNumber: string;
  profileNumber: string;
  assetProfileId: string;
};

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveConfiguredPath(configuredPath: string) {
  return path.resolve(process.cwd(), configuredPath);
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}

function getExtendedPath(settingsJson: Record<string, unknown>, key: string, fallback: string) {
  const value = settingsJson[key];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return fallback;
}

function sortTemplates(templates: CompositeTemplate[]) {
  return [...templates].sort((a, b) => {
    const marketplaceCompare = a.marketplace.localeCompare(b.marketplace);
    if (marketplaceCompare !== 0) return marketplaceCompare;

    const slotA = Number.isFinite(a.slot) ? (a.slot as number) : Number.MAX_SAFE_INTEGER;
    const slotB = Number.isFinite(b.slot) ? (b.slot as number) : Number.MAX_SAFE_INTEGER;
    if (slotA !== slotB) return slotA - slotB;

    const priorityA = Number.isFinite(a.priority) ? (a.priority as number) : Number.MAX_SAFE_INTEGER;
    const priorityB = Number.isFinite(b.priority) ? (b.priority as number) : Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;

    return a.id.localeCompare(b.id);
  });
}

async function pathExists(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function getAuthorizedItem(input: ListingMediaGeneratorInput) {
  const item = await prisma.batchItem.findUnique({
    where: { id: input.itemId },
    include: { batch: true },
  });

  if (!item || item.batchId !== input.batchId) {
    return null;
  }

  if (input.userId && item.batch.userId !== input.userId) {
    return null;
  }

  return item;
}

async function resolveItemContext(input: ListingMediaGeneratorInput): Promise<LoadedItemContext | null> {
  const item = await getAuthorizedItem(input);
  if (!item || !item.outputFolderPath) {
    return null;
  }

  const packageRoot = path.resolve(item.outputFolderPath);
  const packageBaseName = getPackageBaseName(packageRoot);
  const sourceArtworkPngPath = await findExistingNamedFilePath(
    packageRoot,
    [item.baseName, packageBaseName],
    '.png'
  );

  if (!sourceArtworkPngPath || !(await pathExists(sourceArtworkPngPath))) {
    throw new Error('Primary PNG artwork file was not found');
  }

  return {
    packageRoot,
    sourceArtworkPngPath,
    baseName: item.baseName,
    artworkNumber: item.artworkNumber || '',
    profileNumber: item.profileNumber || '',
    assetProfileId: item.assetProfileId || '',
  };
}

function resolveTemplateSelection(
  templates: CompositeTemplate[],
  input: ListingMediaGeneratorInput,
  errors: string[]
) {
  const requestedTemplateIds = Array.from(
    new Set((input.templateIds || []).map((value) => readString(value)).filter(Boolean))
  );

  if (requestedTemplateIds.length > 0) {
    const selected = requestedTemplateIds
      .map((templateId) => {
        const template = templates.find((candidate) => candidate.id === templateId);
        if (!template) {
          errors.push(`Composite template not found: ${templateId}`);
          return null;
        }
        return template;
      })
      .filter((template): template is CompositeTemplate => Boolean(template));

    return sortTemplates(selected);
  }

  const marketplace = readString(input.marketplace);
  const assetProfile = readString(input.assetProfile);

  if (!marketplace && !assetProfile) {
    errors.push('Select templateIds, marketplace, or assetProfile before generating listing media');
    return [];
  }

  const selected = templates.filter((template) => {
    if (marketplace && template.marketplace !== marketplace) return false;
    if (assetProfile && template.assetProfile !== assetProfile) return false;
    return true;
  });

  if (selected.length === 0) {
    errors.push(
      marketplace
        ? `No composite templates found for marketplace: ${marketplace}`
        : `No composite templates found for asset profile: ${assetProfile}`
    );
  }

  return sortTemplates(selected);
}

async function inspectExistingRenderedFile(
  packageRoot: string,
  filePath: string
): Promise<CompositeRenderMetadata | null> {
  if (!(await pathExists(filePath))) return null;

  const metadata = await sharp(filePath)
    .metadata()
    .catch(() => null);
  const relPath = normalizeRelativePath(path.relative(packageRoot, filePath));

  return {
    role: 'main-image',
    path: relPath,
    format: path.extname(filePath).replace('.', '').toLowerCase() || 'unknown',
    width: metadata?.width || 0,
    height: metadata?.height || 0,
    assetProfile: '',
    marketplace: '',
    templateId: '',
    slot: null,
  };
}

function buildSubstitutions(context: LoadedItemContext, template: CompositeTemplate) {
  const packageTitle = context.baseName;

  return {
    ARTWORK_ID: context.artworkNumber || '',
    PROFILE_ID: context.profileNumber || context.assetProfileId || '',
    SKU: context.profileNumber || context.assetProfileId || '',
    PRODUCT_NAME: packageTitle,
    ARTWORK_TITLE: packageTitle,
    PROFILE_TYPE: template.assetProfile,
    MARKETPLACE: template.marketplace,
    TEMPLATE_ID: template.id,
    CURRENT_YEAR: String(new Date().getFullYear()),
    CURRENT_DATE: new Date().toISOString().slice(0, 10),
    PURCHASE_DATE: '',
  };
}

async function renderTemplateIfNeeded(
  context: LoadedItemContext,
  template: CompositeTemplate,
  overwrite: boolean,
  baseAssetsPath: string
) {
  const outputPath = resolveCompositeRenderOutputPath({
    template,
    packageRoot: context.packageRoot,
    sourceArtworkPngPath: context.sourceArtworkPngPath,
    baseAssetsPath,
    substitutions: buildSubstitutions(context, template),
    outputDir: getProfileListingImagesDir(context.packageRoot, template.assetProfile),
  });

  if ((await pathExists(outputPath)) && !overwrite) {
    return {
      skipped: true,
      outputPath,
      metadata: await inspectExistingRenderedFile(context.packageRoot, outputPath),
    };
  }

  const result = await renderCompositeTemplate({
    template,
    packageRoot: context.packageRoot,
    sourceArtworkPngPath: context.sourceArtworkPngPath,
    baseAssetsPath,
    substitutions: buildSubstitutions(context, template),
    outputDir: getProfileListingImagesDir(context.packageRoot, template.assetProfile),
  });

  return {
    skipped: false,
    outputPath: result.outputPath,
    metadata: result.metadata,
    warnings: result.warnings,
  };
}

export async function generateListingMedia(
  input: ListingMediaGeneratorInput
): Promise<ListingMediaGenerationResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const itemContext = await resolveItemContext(input).catch((error) => {
    errors.push(error instanceof Error ? error.message : String(error));
    return null;
  });

  if (!itemContext) {
    return {
      success: false,
      batchId: input.batchId,
      itemId: input.itemId,
      packageRoot: null,
      selectedTemplates: [],
      generated: [],
      skipped: [],
      warnings,
      errors,
    };
  }

  const user = (await prisma.user.findUnique({
    where: { id: input.userId || '' },
    include: {
      settings: true,
    },
  }).catch(() => null)) || null;

  const settings = user?.settings || null;
  const settingsJson = (settings?.defaultSubstitutions as Record<string, unknown>) || {};
  const baseAssetsPath = resolveConfiguredPath(settings?.baseAssetsPath || config.paths.baseAssets);
  const templateRoot = resolveConfiguredPath(
    getExtendedPath(
      settingsJson,
      'templatePath',
      `${settings?.baseAssetsPath || config.paths.baseAssets}/templates`
    )
  );
  const overwrite = Boolean(input.overwrite);
  const templateResult = await loadCompositeTemplates(baseAssetsPath, templateRoot);
  warnings.push(...templateResult.warnings.map((issue) => issue.message));
  errors.push(...templateResult.errors.map((issue) => issue.message));

  const selectedTemplates = resolveTemplateSelection(
    templateResult.templates,
    input,
    errors
  );

  const generated: ListingMediaGeneratedItem[] = [];
  const skipped: ListingMediaSkippedItem[] = [];

  for (const template of selectedTemplates) {
    try {
      const renderResult = await renderTemplateIfNeeded(
        itemContext,
        template,
        overwrite,
        baseAssetsPath
      );

      if (renderResult.skipped) {
        skipped.push({
          templateId: template.id,
          templateName: template.name,
          outputPath: renderResult.outputPath,
          reason: 'Existing file found and overwrite is disabled',
          metadata: renderResult.metadata || undefined,
          warnings: [],
        });
        continue;
      }

      if (!renderResult.metadata) {
        throw new Error(`Composite render did not return metadata for template: ${template.id}`);
      }

      generated.push({
        templateId: template.id,
        templateName: template.name,
        outputPath: renderResult.outputPath,
        metadata: renderResult.metadata,
        warnings: renderResult.warnings || [],
      });
      warnings.push(...(renderResult.warnings || []));
    } catch (error) {
      errors.push(
        `${template.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const success = generated.length > 0 || skipped.length > 0;

  return {
    success,
    batchId: input.batchId,
    itemId: input.itemId,
    packageRoot: itemContext.packageRoot,
    selectedTemplates: selectedTemplates.map((template) => template.id),
    generated,
    skipped,
    warnings,
    errors,
  };
}

export default { generateListingMedia };
