import { NextRequest, NextResponse } from 'next/server';
import { access, stat } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';

type EditableFileType = 'PNG' | 'JPG' | 'SVG';

interface GeneratedFileInput {
  type: string;
  path: string;
}

const EDITABLE_FILE_TYPES: EditableFileType[] = ['PNG', 'JPG', 'SVG'];

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

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const action = body.action as 'file' | 'folder' | 'editable';
    const files = Array.isArray(body.files) ? (body.files as GeneratedFileInput[]) : [];
    const outputFolderPath = typeof body.outputFolderPath === 'string' ? body.outputFolderPath : '';
    const requestedFileType = typeof body.fileType === 'string' ? body.fileType.toUpperCase() : '';

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

    const extended = getExtendedSettings(user.settings?.defaultSubstitutions);
    const editorPath = typeof extended.manualEditorPath === 'string' ? extended.manualEditorPath.trim() : '';

    if (!editorPath) {
      return NextResponse.json(
        { success: false, error: 'Local Only: manual editor is not configured in Settings' },
        { status: 400 }
      );
    }

    if (!path.isAbsolute(editorPath)) {
      return NextResponse.json(
        { success: false, error: 'Local Only: manual editor path must be an absolute path' },
        { status: 400 }
      );
    }

    await assertExistingPath(editorPath, 'file');

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
