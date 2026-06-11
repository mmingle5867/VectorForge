import { stat, writeFile } from 'fs/promises';
import path from 'path';
import config from '@/lib/config';
import { getJpgPath, getPngPath, getSvgPath, getZipPath } from '@/lib/output-naming';
import { normalizeImportedSvg, prepareStrokeOnlySvgForRaster } from '@/lib/svg-normalize';
import { createFixedCanvasSvgRaster } from '@/services/raster-export';
import { createZipFromFolder } from '@/services/zip-generator';

interface SvgImportExportOptions {
  pngExportArtworkColor: string;
  createZip?: boolean;
}

async function fileInfo(type: string, filePath: string) {
  const stats = await stat(filePath);
  return {
    type,
    filename: path.basename(filePath),
    path: filePath,
    size: stats.size,
  };
}

export async function exportImportedSvgPackage(
  originalSvg: string,
  outputDir: string,
  options: SvgImportExportOptions
) {
  const normalized = normalizeImportedSvg(originalSvg);
  const svgPath = getSvgPath(outputDir);
  const pngPath = getPngPath(outputDir);
  const jpgPath = getJpgPath(outputDir);
  const zipPath = getZipPath(outputDir);
  const strokeWidth = config.processing.svgRasterStrokeWidth;
  const pngSvg = normalized.isStrokeOnly
    ? prepareStrokeOnlySvgForRaster(normalized.svg, {
        strokeColor: options.pngExportArtworkColor,
        strokeWidth,
      })
    : normalized.svg;
  const jpgSvg = normalized.isStrokeOnly
    ? prepareStrokeOnlySvgForRaster(normalized.svg, {
        strokeColor: '#000000',
        strokeWidth,
      })
    : normalized.svg;

  await writeFile(svgPath, originalSvg, 'utf-8');
  await createFixedCanvasSvgRaster(Buffer.from(pngSvg, 'utf-8'), pngPath, {
    width: config.processing.rasterExportWidth,
    height: config.processing.rasterExportHeight,
    format: 'png',
    artworkColor: options.pngExportArtworkColor,
    preserveColors: normalized.hasFilledColors || normalized.isStrokeOnly,
  });
  await createFixedCanvasSvgRaster(Buffer.from(jpgSvg, 'utf-8'), jpgPath, {
    width: config.processing.rasterExportWidth,
    height: config.processing.rasterExportHeight,
    format: 'jpg',
    quality: 90,
    preserveColors: normalized.hasFilledColors || normalized.isStrokeOnly,
  });

  const zipResult = options.createZip ? await createZipFromFolder(outputDir, zipPath) : null;
  const files = [
    await fileInfo('svg', svgPath),
    await fileInfo('png', pngPath),
    await fileInfo('jpg', jpgPath),
  ];

  if (zipResult) {
    files.push(await fileInfo('zip', zipPath));
  }

  return {
    normalized,
    svgPath,
    pngPath,
    jpgPath,
    zipPath: zipResult ? zipPath : null,
    files,
  };
}
