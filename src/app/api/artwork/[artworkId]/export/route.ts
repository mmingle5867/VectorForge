import { execFile } from 'node:child_process';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';

const execFileAsync = promisify(execFile);
const FORMATS = ['SVG', 'JPG', 'PNG', 'PNG_MASK', 'PDF'] as const;
type ExportFormat = typeof FORMATS[number];

function settingsRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function chooseExportDirectory(initialPath: string | undefined) {
  if (process.platform !== 'win32') throw new Error('Local folder selection is currently available on Windows only.');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Select the VectorForge export folder'",
    "$initial = [Environment]::GetEnvironmentVariable('VECTORFORGE_EXPORT_DIRECTORY')",
    'if ($initial -and (Test-Path -LiteralPath $initial)) { $dialog.SelectedPath = $initial }',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    windowsHide: false,
    env: { ...process.env, VECTORFORGE_EXPORT_DIRECTORY: initialPath || '' },
  });
  const selected = stdout.trim();
  return selected || null;
}

async function uniqueDestination(directory: string, sourcePath: string) {
  const parsed = path.parse(sourcePath);
  for (let number = 0; ; number += 1) {
    const name = number === 0 ? parsed.base : `${parsed.name} (${number})${parsed.ext}`;
    const target = path.join(directory, name);
    try {
      await access(target);
    } catch {
      return target;
    }
  }
}

function sourceForFormat(assets: Array<{ role: string; filePath: string | null }>, format: ExportFormat) {
  const roles: Record<ExportFormat, string[]> = {
    SVG: ['approved-svg'],
    JPG: ['raster-output-jpg', 'approved-jpg', 'source-file'],
    PNG: ['raster-output-png', 'approved-png', 'working-png'],
    PNG_MASK: ['raster-output-png_mask'],
    PDF: ['raster-output-pdf'],
  };
  for (const role of roles[format]) {
    const asset = assets.find((candidate) => candidate.role === role && candidate.filePath);
    if (asset?.filePath) return asset.filePath;
  }
  return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    const body = await request.json();
    const formats = Array.isArray(body.formats)
      ? [...new Set(body.formats.filter((format): format is ExportFormat => FORMATS.includes(format as ExportFormat)))]
      : [];
    if (formats.length === 0) return NextResponse.json({ success: false, error: 'Check at least one image format to export.' }, { status: 400 });

    const [artwork, userWithSettings] = await Promise.all([
      prisma.artwork.findFirst({
        where: { id: artworkId, userId: user.id, status: 'ACTIVE', batchItems: { none: {} } },
        include: { assets: { where: { status: 'ACTIVE' } } },
      }),
      prisma.user.findUnique({ where: { id: user.id }, include: { settings: true } }),
    ]);
    if (!artwork || !userWithSettings) return NextResponse.json({ success: false, error: 'Artwork was not found.' }, { status: 404 });

    const settings = settingsRecord(userWithSettings.settings?.defaultSubstitutions);
    const lastDirectory = typeof settings.lastExportDirectory === 'string' ? settings.lastExportDirectory : undefined;
    const directory = await chooseExportDirectory(lastDirectory);
    if (!directory) return NextResponse.json({ success: true, cancelled: true, files: [] });

    await mkdir(directory, { recursive: true });
    const files: Array<{ format: ExportFormat; path: string }> = [];
    for (const format of formats) {
      const source = sourceForFormat(artwork.assets, format);
      if (!source) throw new Error(format === 'SVG' ? 'Save the vector result before exporting SVG.' : `No ${format === 'PNG_MASK' ? 'PNG Mask' : format} file is available to export.`);
      await access(source);
      const target = await uniqueDestination(directory, source);
      await copyFile(source, target);
      files.push({ format, path: target });
    }

    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: { defaultSubstitutions: { ...settings, lastExportDirectory: directory } },
      create: { userId: user.id, defaultSubstitutions: { ...settings, lastExportDirectory: directory } },
    });
    return NextResponse.json({ success: true, cancelled: false, files, directory });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to export files.' }, { status: 400 });
  }
}
