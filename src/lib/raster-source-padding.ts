import sharp from 'sharp';

export interface RasterSourcePaddingResult {
  buffer: Buffer;
  width: number;
  height: number;
  padding: number;
}

function clampDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function clampCropAmount(width: number, height: number, padding: number) {
  const maxCropX = Math.max(0, Math.floor((width - 1) / 2));
  const maxCropY = Math.max(0, Math.floor((height - 1) / 2));
  return Math.min(Math.abs(Math.round(padding)), maxCropX, maxCropY);
}

export async function applyRasterSourcePadding(
  input: Buffer,
  paddingPx: number,
  background: { r: number; g: number; b: number; alpha: number }
): Promise<RasterSourcePaddingResult> {
  const padding = Number.isFinite(paddingPx) ? Math.round(paddingPx) : 0;
  const metadata = await sharp(input).metadata();
  const width = clampDimension(metadata.width || 1);
  const height = clampDimension(metadata.height || 1);

  if (padding === 0) {
    return {
      buffer: input,
      width,
      height,
      padding: 0,
    };
  }

  if (padding > 0) {
    const buffer = await sharp(input)
      .ensureAlpha()
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background,
      })
      .png()
      .toBuffer();

    return {
      buffer,
      width: width + padding * 2,
      height: height + padding * 2,
      padding,
    };
  }

  const crop = clampCropAmount(width, height, padding);
  const croppedWidth = Math.max(1, width - crop * 2);
  const croppedHeight = Math.max(1, height - crop * 2);

  const buffer = await sharp(input)
    .ensureAlpha()
    .extract({
      left: crop,
      top: crop,
      width: croppedWidth,
      height: croppedHeight,
    })
    .png()
    .toBuffer();

  return {
    buffer,
    width: croppedWidth,
    height: croppedHeight,
    padding,
  };
}
