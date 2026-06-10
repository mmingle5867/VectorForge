import sharp from 'sharp';

export interface RasterExportOptions {
  width: number;
  height: number;
  format: 'jpg' | 'jpeg' | 'png';
  quality?: number;
}

function safeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 2000;
}

export async function createFixedCanvasRaster(
  input: Buffer,
  outputPath: string,
  options: RasterExportOptions
): Promise<void> {
  const targetWidth = safeDimension(options.width);
  const targetHeight = safeDimension(options.height);
  const isPng = options.format === 'png';
  const background = isPng
    ? { r: 255, g: 255, b: 255, alpha: 0 }
    : { r: 255, g: 255, b: 255, alpha: 1 };

  const resized = await sharp(input)
    .resize(targetWidth, targetHeight, {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  const resizedMeta = await sharp(resized).metadata();
  const left = Math.round((targetWidth - (resizedMeta.width || targetWidth)) / 2);
  const top = Math.round((targetHeight - (resizedMeta.height || targetHeight)) / 2);

  const canvas = sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 4,
      background,
    },
  }).composite([{ input: resized, left, top }]);

  if (isPng) {
    await canvas.png().toFile(outputPath);
    return;
  }

  await canvas
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: options.quality ?? 90 })
    .toFile(outputPath);
}
