import sharp from 'sharp';
import {
  findExistingFilePath,
  findExistingNamedFilePath,
  getPackageBaseName,
  getZipPath,
} from '@/lib/output-naming';
import { generateMarketplacePreview } from '@/services/marketplace-preview';
import { generateMetadataFile } from '@/services/metadata';
import { generateSkuFile } from '@/services/sku-generator';
import { applyBaseAssets } from '@/services/base-assets';
import { createZipFromFolder } from '@/services/zip-generator';
import { generatePackageManifest } from '@/services/package-manifest';
import {
  generatePackageDocuments,
  type PackageDocumentSettings,
} from '@/services/template-renderer';
import { upsertGeneratedAssetsForBatchItem } from '@/services/sema-identity';
import type { SubstitutionData } from '@/lib/types';

interface FinalizePackageInput {
  item: {
    id?: string | null;
    originalFilename: string;
    baseName: string;
    sequenceNumber: number;
    mimeType: string | null;
    originalWidth: number | null;
    originalHeight: number | null;
    upscaledWidth: number | null;
    upscaledHeight: number | null;
    upscaleFactor: number;
    upscaleApplied: boolean;
    uploadPath: string | null;
    svgPath: string | null;
    outputFolderPath: string | null;
    artworkId?: string | null;
    assetProfileId?: string | null;
    artworkNumber?: string | null;
    profileNumber?: string | null;
  };
  substitutionData: SubstitutionData;
  baseAssetsPath: string;
  copyBaseAssetsToOutput: boolean;
  enableMarketplacePreview: boolean;
  enableColorTint: boolean;
  tintColor: string;
  watermarkOpacity: number;
  backgroundFilename: string;
  watermarkFilename: string;
  cncMode: boolean;
  documentSettings?: PackageDocumentSettings;
}

async function readImageDimensions(imagePath: string | null) {
  if (!imagePath) return { width: 0, height: 0 };

  try {
    const metadata = await sharp(imagePath).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

export async function finalizeManualEditPackage(input: FinalizePackageInput) {
  const outputDir = input.item.outputFolderPath;
  if (!outputDir) {
    throw new Error('No output folder is available for this item');
  }

  const packageBaseName = getPackageBaseName(outputDir);
  const candidateBaseNames = [packageBaseName, input.item.baseName];
  const svgPath = await findExistingFilePath([
    input.item.svgPath,
    await findExistingNamedFilePath(outputDir, candidateBaseNames, '.svg'),
  ]);
  const pngPath = await findExistingNamedFilePath(outputDir, candidateBaseNames, '.png');
  const jpgPath = await findExistingNamedFilePath(outputDir, candidateBaseNames, '.jpg');

  if (!svgPath) {
    throw new Error('Cannot finalize package because the saved SVG file was not found');
  }
  if (!pngPath && !jpgPath) {
    throw new Error('Cannot finalize package because no saved PNG or JPG file was found');
  }

  const editedRasterSource = pngPath || jpgPath;
  if (!editedRasterSource) {
    throw new Error('Cannot finalize package because no saved PNG or JPG file was found');
  }
  let marketplacePreviewPath: string | null = null;

  if (input.enableMarketplacePreview) {
    const previewResult = await generateMarketplacePreview(
      editedRasterSource,
      outputDir,
      input.item.baseName,
      {
        enableColorTint: input.enableColorTint,
        tintColor: input.tintColor,
        watermarkOpacity: input.watermarkOpacity,
        backgroundFilename: input.backgroundFilename,
        watermarkFilename: input.watermarkFilename,
        baseAssetsPath: input.baseAssetsPath,
      }
    );

    if (!previewResult) {
      throw new Error('Marketplace preview generation failed');
    }

    marketplacePreviewPath = previewResult.path;
  }

  const { width, height } = await readImageDimensions(editedRasterSource);
  const { sku, file: skuFile } = await generateSkuFile(
    outputDir,
    input.item.baseName,
    input.item.sequenceNumber || 1
  );
  const metadataPath = await generateMetadataFile(outputDir, {
    originalFilename: input.item.originalFilename,
    baseName: input.item.baseName,
    sku,
    conversionDate: new Date().toISOString(),
    originalWidth: input.item.originalWidth || width,
    originalHeight: input.item.originalHeight || height,
    upscaledWidth: input.item.upscaledWidth || width,
    upscaledHeight: input.item.upscaledHeight || height,
    upscaleFactor: input.item.upscaleFactor,
    upscaleApplied: input.item.upscaleApplied,
    formats: ['svg', 'png', 'jpg'],
    substitutionData: input.substitutionData,
    marketplacePreview: !!marketplacePreviewPath,
    cncMode: input.cncMode,
  });

  if (input.copyBaseAssetsToOutput) {
    await applyBaseAssets(outputDir, input.baseAssetsPath);
  }

  const fileTypes = [
    svgPath ? 'SVG' : null,
    pngPath ? 'PNG' : null,
    jpgPath ? 'JPG' : null,
  ].filter((type): type is string => Boolean(type));
  const { readmePath, licensePath } = await generatePackageDocuments({
    outputDir,
    baseAssetsPath: input.baseAssetsPath,
    productName: input.item.baseName,
    sku,
    artworkId: input.item.artworkNumber || input.item.artworkId,
    profileId: input.item.profileNumber || input.item.assetProfileId,
    fileTypes,
    profileType: 'digital',
    artworkTitle: input.item.baseName,
    settings: input.documentSettings,
  });

  const zipPath = getZipPath(outputDir, input.item.baseName);
  await createZipFromFolder(outputDir, zipPath);

  if (input.item.id) {
    await upsertGeneratedAssetsForBatchItem(input.item.id, [
      { role: 'primary-svg', filePath: svgPath, mimeType: 'image/svg+xml' },
      { role: 'primary-png', filePath: pngPath, mimeType: 'image/png' },
      { role: 'primary-jpg', filePath: jpgPath, mimeType: 'image/jpeg' },
      { role: 'preview', filePath: marketplacePreviewPath, mimeType: 'image/jpeg' },
      { role: 'metadata', filePath: metadataPath, mimeType: 'text/plain' },
      { role: 'sku-file', filePath: skuFile.path, mimeType: 'text/plain' },
      { role: 'customer-zip', filePath: zipPath, mimeType: 'application/zip' },
    ].filter((asset) => Boolean(asset.filePath)));
  }

  const manifestPath = await generatePackageManifest({
    outputDir,
    item: input.item,
    sku,
    svgPath,
    pngPath,
    jpgPath,
    marketplacePreviewPath,
    metadataPath,
    skuFilePath: skuFile.path,
    readmePath,
    licensePath,
    zipPath,
    licenseType:
      input.documentSettings?.defaultLicenseType ||
      input.documentSettings?.templateVariables?.LICENSE_TYPE ||
      '',
  });

  return {
    sku,
    skuFilePath: skuFile.path,
    metadataPath,
    readmePath,
    licensePath,
    manifestPath,
    marketplacePreviewPath,
    zipPath,
    svgPath,
  };
}
