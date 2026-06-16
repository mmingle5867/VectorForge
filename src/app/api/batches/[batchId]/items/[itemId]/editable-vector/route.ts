import { NextRequest, NextResponse } from 'next/server';
import { access, mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { getSvgPath } from '@/lib/output-naming';
import { getIncrementalFolderName } from '@/lib/server-utils';
import { getSvgDiagnostics } from '@/services/tuned-svg';

type EditableVectorAction = 'open' | 'prepare' | 'reload';

function resolveConfiguredPath(configuredPath: string) {
  return path.resolve(process.cwd(), configuredPath);
}

function isInsideDirectory(targetPath: string, directoryPath: string) {
  const relative = path.relative(directoryPath, targetPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertExistingFile(filePath: string) {
  await access(filePath);
  const stats = await stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`${filePath} is not a file`);
  }
  return stats;
}

function launchDetached(command: string, args: string[]) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

function getExtendedSettings(settings: unknown) {
  return (settings as Record<string, unknown>) || {};
}

async function getVectorEditorPath(extended: Record<string, unknown>) {
  const editorPath =
    typeof extended.vectorEditorPath === 'string' ? extended.vectorEditorPath.trim() : '';

  if (!editorPath) {
    throw new Error('Local Only: vector editor is not configured in Settings');
  }

  if (!path.isAbsolute(editorPath)) {
    throw new Error('Local Only: vector editor path must be an absolute path');
  }

  await assertExistingFile(editorPath);
  return editorPath;
}

function decodePreviewSvg(previewSvgBase64: unknown) {
  if (typeof previewSvgBase64 !== 'string' || !previewSvgBase64.trim()) {
    throw new Error('Generate a preview before opening an editable vector');
  }

  const svg = Buffer.from(previewSvgBase64, 'base64').toString('utf-8');
  if (!/<svg\b/i.test(svg)) {
    throw new Error('Current preview does not contain valid SVG data');
  }

  return svg;
}

async function ensureOutputFolder(input: {
  item: {
    id: string;
    baseName: string;
    outputFolderPath: string | null;
  };
  outputRoot: string;
}) {
  if (input.item.outputFolderPath) {
    const resolved = path.resolve(input.item.outputFolderPath);
    if (!isInsideDirectory(resolved, input.outputRoot)) {
      throw new Error('Item output folder is outside the configured output directory');
    }
    await mkdir(resolved, { recursive: true });
    return resolved;
  }

  await mkdir(input.outputRoot, { recursive: true });
  const outputFolderName = await getIncrementalFolderName(input.outputRoot, input.item.baseName);
  const outputFolderPath = path.join(input.outputRoot, outputFolderName);

  await mkdir(outputFolderPath, { recursive: true });
  await prisma.batchItem.update({
    where: { id: input.item.id },
    data: { outputFolderPath },
  });

  return outputFolderPath;
}

async function getTrackedSvgPath(input: {
  item: {
    id: string;
    baseName: string;
    svgPath: string | null;
  };
  outputFolderPath: string;
  outputRoot: string;
  previewSvgBase64?: unknown;
  createFromPreview: boolean;
}) {
  const existingSvgPath = input.item.svgPath ? path.resolve(input.item.svgPath) : null;
  const packageSvgPath = path.resolve(getSvgPath(input.outputFolderPath, input.item.baseName));
  const editableSvgPath = path.resolve(input.outputFolderPath, `${input.item.baseName}-editable.svg`);

  const candidatePaths = [
    existingSvgPath,
    packageSvgPath,
    editableSvgPath,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidatePaths) {
    if (!isInsideDirectory(candidate, input.outputRoot)) {
      throw new Error('Editable vector file is outside the configured output directory');
    }
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  if (!input.createFromPreview) {
    throw new Error('No editable vector file exists yet');
  }

  const svg = decodePreviewSvg(input.previewSvgBase64);
  await writeFile(editableSvgPath, svg, 'utf-8');
  await prisma.batchItem.update({
    where: { id: input.item.id },
    data: { svgPath: editableSvgPath },
  });

  return editableSvgPath;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string; itemId: string }> }
) {
  try {
    const user = await requireAuth();
    const { batchId, itemId } = await params;
    const body = await req.json();
    const action = body.action as EditableVectorAction;

    if (action !== 'open' && action !== 'prepare' && action !== 'reload') {
      return NextResponse.json(
        { success: false, error: 'Unsupported editable vector action' },
        { status: 400 }
      );
    }

    const item = await prisma.batchItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item || item.batchId !== batchId || item.batch.userId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Batch item was not found' },
        { status: 404 }
      );
    }

    const outputRoot = resolveConfiguredPath(user.settings?.outputPath || config.paths.output);
    const outputFolderPath = await ensureOutputFolder({ item, outputRoot });
    const svgPath = await getTrackedSvgPath({
      item,
      outputFolderPath,
      outputRoot,
      previewSvgBase64: body.previewSvgBase64,
      createFromPreview: action === 'open' || action === 'prepare',
    });

    if (!isInsideDirectory(svgPath, outputRoot)) {
      return NextResponse.json(
        { success: false, error: 'Editable vector file is outside the configured output directory' },
        { status: 400 }
      );
    }

    const stats = await assertExistingFile(svgPath);

    if (action === 'prepare') {
      return NextResponse.json({
        success: true,
        outputFolderPath,
        svgPath,
        file: {
          type: 'svg',
          filename: path.basename(svgPath),
          path: svgPath,
          size: stats.size,
        },
      });
    }

    if (action === 'open') {
      const extended = getExtendedSettings(user.settings?.defaultSubstitutions);
      const editorPath = await getVectorEditorPath(extended);
      launchDetached(editorPath, [svgPath]);

      return NextResponse.json({
        success: true,
        outputFolderPath,
        file: {
          type: 'svg',
          filename: path.basename(svgPath),
          path: svgPath,
          size: stats.size,
        },
      });
    }

    const svg = await readFile(svgPath, 'utf-8');
    return NextResponse.json({
      success: true,
      outputFolderPath,
      svgPath,
      svgBase64: Buffer.from(svg, 'utf-8').toString('base64'),
      svgSize: Buffer.byteLength(svg, 'utf-8'),
      diagnostics: getSvgDiagnostics(svg),
      file: {
        type: 'svg',
        filename: path.basename(svgPath),
        path: svgPath,
        size: stats.size,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to handle editable vector';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
