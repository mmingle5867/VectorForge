import { execFile } from 'node:child_process';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getManagedArtworkDirectory } from '@/lib/artwork-storage-paths';

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

async function uniqueDestination(directory: string, filename: string) {
  const parsed = path.parse(filename);
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

function sourceForFormat(assets: Array<{ id: string; role: string; filePath: string | null }>, format: ExportFormat) {
  const roles: Record<Exclude<ExportFormat, 'SVG'>, string[]> = {
    JPG: ['source-file', 'raster-output-jpg', 'approved-jpg'],
    PNG: ['raster-output-png', 'approved-png', 'working-png'],
    PNG_MASK: ['raster-output-png_mask'],
    PDF: ['raster-output-pdf'],
  };
  if (format === 'SVG') return assets.find((candidate) => candidate.role === 'approved-svg') || null;
  for (const role of roles[format]) {
    const asset = assets.find((candidate) => candidate.role === role && candidate.filePath);
    if (asset) return asset;
  }
  return null;
}

function filenameForFormat(baseName: string, format: ExportFormat) {
  return `${baseName}${format === 'JPG' ? '.jpg' : format === 'PNG' ? '.png' : format === 'PNG_MASK' ? '-mask.png' : format === 'PDF' ? '.pdf' : '.svg'}`;
}

async function resolveAssetPath(asset: { id: string; filePath: string | null }) {
  if (asset.filePath) {
    try {
      await access(asset.filePath);
      return asset.filePath;
    } catch { /* Resolve its latest recorded location below. */ }
  }
  const version = await prisma.assetVersion.findFirst({
    where: { assetId: asset.id, status: { not: 'RETIRED' } },
    orderBy: { versionNumber: 'desc' },
    include: { locations: { where: { isPrimary: true, status: 'AVAILABLE' }, include: { storageLocation: { select: { basePath: true } } }, take: 1 } },
  });
  const location = version?.locations[0];
  if (!location) return null;
  const resolved = path.resolve(location.storageLocation.basePath, location.relativePath);
  await access(resolved);
  return resolved;
}

async function currentSvgCandidatePath(input: { artworkId: string; userId: string; workingPath: string; candidateId: unknown }) {
  if (typeof input.candidateId !== 'string' || !/^[A-Za-z0-9-]+$/.test(input.candidateId)) return null;
  const candidate = await prisma.semaCoreCommand.findFirst({
    where: { id: input.candidateId, actorId: input.userId, commandType: 'vectorforge.artwork.vector-preview', status: 'SUCCESS' },
    select: { subjectIds: true },
  });
  const subjects = candidate && Array.isArray(candidate.subjectIds) ? candidate.subjectIds : [];
  if (!candidate || !subjects.includes(input.artworkId)) return null;
  const directory = getManagedArtworkDirectory(input.workingPath);
  if (!directory) return null;
  const candidatePath = path.join(directory, 'vectorforge', 'vectorized', '.preview', `${input.candidateId}.svg`);
  await access(candidatePath);
  return candidatePath;
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
    const baseName = artwork.outputBaseName || artwork.title || 'artwork';
    const working = artwork.assets.find((asset) => asset.role === 'source-file' && asset.filePath);
    for (const format of formats) {
      const asset = sourceForFormat(artwork.assets, format);
      let source = asset ? await resolveAssetPath(asset) : null;
      if (format === 'SVG' && !source && working?.filePath) {
        source = await currentSvgCandidatePath({ artworkId, userId: user.id, workingPath: working.filePath, candidateId: body.candidateId });
      }
      if (!source) throw new Error(`No ${format === 'PNG_MASK' ? 'PNG Mask' : format} file is available to export. Create it first.`);
      const target = await uniqueDestination(directory, filenameForFormat(baseName, format));
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
