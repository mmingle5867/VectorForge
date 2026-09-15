import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export type OutputFormat = 'JPG' | 'PNG' | 'PNG_MASK' | 'PDF';
export type DimensionUnit = 'IN' | 'MM';
export type ConstrainBy = 'WIDTH' | 'HEIGHT';

export interface RasterOutputSpecification {
  constrainBy: ConstrainBy;
  value: number;
  unit: DimensionUnit;
  dpi: number;
  formats: OutputFormat[];
}

export function resolveRasterOutputSize(source: { width: number; height: number }, spec: RasterOutputSpecification) {
  if (spec.value <= 0 || spec.dpi <= 0) throw new Error('Size and DPI must be greater than zero.');
  const inches = spec.unit === 'MM' ? spec.value / 25.4 : spec.value;
  const constrainedPixels = Math.round(inches * spec.dpi);
  const ratio = source.width / source.height;
  return spec.constrainBy === 'WIDTH'
    ? { width: constrainedPixels, height: Math.round(constrainedPixels / ratio), inchesWide: inches, inchesHigh: inches / ratio }
    : { width: Math.round(constrainedPixels * ratio), height: constrainedPixels, inchesWide: inches * ratio, inchesHigh: inches };
}

export async function exportRasterOutputs(input: { sourcePath: string; outputDirectory: string; baseName: string; spec: RasterOutputSpecification }) {
  const meta = await sharp(input.sourcePath).metadata();
  if (!meta.width || !meta.height) throw new Error('Unable to determine source image dimensions.');
  const dimensions = resolveRasterOutputSize({ width: meta.width, height: meta.height }, input.spec);
  await mkdir(input.outputDirectory, { recursive: true });
  const outputs: Array<{ format: OutputFormat; path: string; mimeType: string }> = [];
  const image = sharp(input.sourcePath).resize(dimensions.width, dimensions.height, { fit: 'fill' }).withMetadata({ density: input.spec.dpi });
  if (input.spec.formats.includes('JPG')) { const target = path.join(input.outputDirectory, `${input.baseName}.jpg`); await image.clone().jpeg().toFile(target); outputs.push({ format: 'JPG', path: target, mimeType: 'image/jpeg' }); }
  if (input.spec.formats.includes('PNG')) {
    const { data, info } = await image.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index] === 255 && data[index + 1] === 255 && data[index + 2] === 255) data[index + 3] = 0;
    }
    const target = path.join(input.outputDirectory, `${input.baseName}.png`);
    await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toFile(target);
    outputs.push({ format: 'PNG', path: target, mimeType: 'image/png' });
  }
  if (input.spec.formats.includes('PNG_MASK')) { const target = path.join(input.outputDirectory, `${input.baseName}-mask.png`); await image.clone().grayscale().png().toFile(target); outputs.push({ format: 'PNG_MASK', path: target, mimeType: 'image/png' }); }
  if (input.spec.formats.includes('PDF')) { const bytes = await image.clone().jpeg().toBuffer(); const pdf = await PDFDocument.create(); const embedded = await pdf.embedJpg(bytes); const page = pdf.addPage([dimensions.inchesWide * 72, dimensions.inchesHigh * 72]); page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() }); const target = path.join(input.outputDirectory, `${input.baseName}.pdf`); await writeFile(target, await pdf.save()); outputs.push({ format: 'PDF', path: target, mimeType: 'application/pdf' }); }
  return { dimensions, outputs };
}