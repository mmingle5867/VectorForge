import { NextRequest, NextResponse } from 'next/server';
import { access, stat } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import prisma from '@/lib/prisma';

type EditableFileType = 'PNG' | 'JPG' | 'SVG';
type EditorAction = 'file' | 'folder' | 'editable' | 'original-raster';

interface GeneratedFileInput {
  type: string;
  path: string;
}

const EDITABLE_FILE_TYPES: EditableFileType[] = ['PNG', 'JPG', 'SVG'];
const RASTER_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
]);
const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

function resolveConfiguredPath(configuredPath: string) {
  return path.resolve(process.cwd(), configuredPath);
}

function isInsideDirectory(targetPath: string, directoryPath: string) {
  const relative = path.relative(directoryPath, targetPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function getExtendedSettings(settings: unknown) {
  return (settings as Record<string, unknown>) || {};
}

function getSelectedFileTypes(value: unknown): EditableFileType[] {
  if (!Array.isArray(value)) return ['PNG'];

  const selected = value.filter((item): item is EditableFileType =>
    EDITABLE_FILE_TYPES.includes(item as EditableFileType)
  );

  return selected.length > 0 ? selected : ['PNG'];
}

function isRasterUpload(mimeType?: string | null, filename?: string | null) {
  const normalizedMime = (mimeType || '').toLowerCase();
  const extension = path.extname(filename || '').toLowerCase();
  return normalizedMime !== 'image/svg+xml' && (
    RASTER_MIME_TYPES.has(normalizedMime) || RASTER_EXTENSIONS.has(extension)
  );
}

async function assertExistingPath(filePath: string, expected: 'file' | 'directory') {
  await access(filePath);
  const stats = await stat(filePath);
  if (expected === 'file' && !stats.isFile()) {
    throw new Error(`${filePath} is not a file`);
  }
  if (expected === 'directory' && !stats.isDirectory()) {
    throw new Error(`${filePath} is not a directory`);
  }
}

function launchDetached(command: string, args: string[]) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

function openFolder(folderPath: string) {
  if (process.platform === 'win32') {
    launchDetached('explorer.exe', [folderPath]);
    return;
  }

  launchDetached(process.platform === 'darwin' ? 'open' : 'xdg-open', [folderPath]);
}

async function getManualEditorPath(extended: Record<string, unknown>) {
  const editorPath =
    typeof extended.manualEditorPath === 'string' ? extended.manualEditorPath.trim() : '';

  if (!editorPath) {
    throw new Error('Local Only: manual editor is not configured in Settings');
  }

  if (!path.isAbsolute(editorPath)) {
    throw new Error('Local Only: manual editor path must be an absolute path');
  }

  await assertExistingPath(editorPath, 'file');
  return editorPath;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const action = body.action as EditorAction;
    const files = Array.isArray(body.files) ? (body.files as GeneratedFileInput[]) : [];
    const outputFolderPath = typeof body.outputFolderPath === 'string' ? body.outputFolderPath : '';
    const requestedFileType = typeof body.fileType === 'string' ? body.fileType.toUpperCase() : '';
    const extended = getExtendedSettings(user.settings?.defaultSubstitutions);

    if (action === 'original-raster') {
      const batchId = typeof body.batchId === 'string' ? body.batchId : '';
      const itemId = typeof body.itemId === 'string' ? body.itemId : '';

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

      if (!isRasterUpload(item.mimeType, item.originalFilename)) {
        return NextResponse.json(
          { success: false, error: 'Original raster editing is only available for JPG, PNG, WEBP, or TIFF uploads' },
          { status: 400 }
        );
      }

      if (!item.uploadPath) {
        return NextResponse.json(
          { success: false, error: 'Original raster file path is missing' },
          { status: 400 }
        );
      }

      const uploadsRoot = resolveConfiguredPath(config.paths.uploads);
      const resolvedUploadPath = path.resolve(item.uploadPath);

      if (!isInsideDirectory(resolvedUploadPath, uploadsRoot)) {
        return NextResponse.json(
          { success: false, error: 'Original raster file is outside the configured uploads directory' },
          { status: 400 }
        );
      }

      try {
        await assertExistingPath(resolvedUploadPath, 'file');
      } catch {
        return NextResponse.json(
          { success: false, error: 'Original raster file is missing on disk' },
          { status: 404 }
        );
      }

      const editorPath = await getManualEditorPath(extended);
      launchDetached(editorPath, [resolvedUploadPath]);
      return NextResponse.json({ success: true });
    }

    const configuredOutputPath = user.settings?.outputPath || config.paths.output;
    const outputRoot = resolveConfiguredPath(configuredOutputPath);
    const resolvedOutputFolder = path.resolve(outputFolderPath);

    if (!isInsideDirectory(resolvedOutputFolder, outputRoot)) {
      return NextResponse.json(
        { success: false, error: 'Output folder is outside the configured output directory' },
        { status: 400 }
      );
    }

    if (action === 'folder') {
      await assertExistingPath(resolvedOutputFolder, 'directory');
      openFolder(resolvedOutputFolder);
      return NextResponse.json({ success: true });
    }

    const editorPath = await getManualEditorPath(extended);

    const requestedTypes =
      action === 'editable'
        ? getSelectedFileTypes(extended.manualEditorFileTypes)
        : EDITABLE_FILE_TYPES.includes(requestedFileType as EditableFileType)
          ? [requestedFileType as EditableFileType]
          : [];

    if (requestedTypes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No editable file type was selected' },
        { status: 400 }
      );
    }

    const requestedPaths = requestedTypes
      .map((fileType) => {
        const match = files.find((file) => file.type.toLowerCase() === fileType.toLowerCase());
        return match ? path.resolve(match.path) : null;
      })
      .filter((filePath): filePath is string => !!filePath);

    if (requestedPaths.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No saved files match the selected editor file types' },
        { status: 400 }
      );
    }

    for (const filePath of requestedPaths) {
      if (!isInsideDirectory(filePath, outputRoot)) {
        return NextResponse.json(
          { success: false, error: 'Selected file is outside the configured output directory' },
          { status: 400 }
        );
      }
      await assertExistingPath(filePath, 'file');
    }

    const allowMultipleFiles = Boolean(extended.manualEditorAllowMultipleFiles);
    if (allowMultipleFiles) {
      launchDetached(editorPath, requestedPaths);
    } else {
      for (const filePath of requestedPaths) {
        launchDetached(editorPath, [filePath]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open local editor';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
