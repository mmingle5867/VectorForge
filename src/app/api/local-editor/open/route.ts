import { NextRequest, NextResponse } from 'next/server';
import { access, stat } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { requireAuth } from '@/lib/auth';
import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { configureDefaultImportStorageForUser } from '@/services/profile-storage';
import { normalizeRasterEditorPreparation } from '@/lib/control-presets';
import { logger } from '@/lib/logger';
import { prepareDirectRasterForEditor, prepareRasterForEditor } from '@/services/raster-editor-preparation';
import { ensureDirectWorkingJpeg } from '@/services/direct-working-raster';

type EditableFileType = 'PNG' | 'JPG' | 'SVG';
type EditorAction = 'file' | 'folder' | 'editable' | 'original-raster' | 'direct-vector' | 'direct-output-raster' | 'direct-output-folder' | 'direct-working-png' | 'export-folder';

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

function getExtendedPath(settingsJson: unknown, key: string, fallback: string) {
  if (settingsJson && typeof settingsJson === 'object' && !Array.isArray(settingsJson)) {
    const value = (settingsJson as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

function isInsideDirectory(targetPath: string, directoryPath: string) {
  const relative = path.relative(directoryPath, targetPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isInsideAuthorizedProfileStorage(input: {
  profileId: string;
  defaultArtworkPath: string;
  filePath: string;
}) {
  if (isInsideDirectory(input.filePath, input.defaultArtworkPath)) return true;

  // Existing artwork may remain at a registered prior/local/cloud location
  // after the default import location changes. Registration, rather than a
  // folder-name pattern, remains the authorization boundary.
  const locations = await prisma.storageLocation.findMany({
    where: { profileId: input.profileId, status: 'ACTIVE', isReadOnly: false },
    select: { basePath: true },
  });
  return locations.some((location) => isInsideDirectory(input.filePath, location.basePath));
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
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    // A configured editor must either spawn promptly or report a clear error.
    // Do not leave the browser request pending indefinitely when Windows cannot
    // start the associated executable.
    const timeout = setTimeout(() => finish(() => reject(new Error(`Timed out while starting ${path.basename(command)}`))), 5000);
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('spawn', () => {
      child.unref();
      finish(resolve);
    });
  });
}

async function openFolder(folderPath: string) {
  if (process.platform === 'win32') {
    await launchDetached('explorer.exe', [folderPath]);
    return;
  }

  await launchDetached(process.platform === 'darwin' ? 'open' : 'xdg-open', [folderPath]);
}

async function openFileWithDefaultApp(filePath: string) {
  if (process.platform === 'win32') {
    await launchDetached('explorer.exe', [filePath]);
    return;
  }

  await launchDetached(process.platform === 'darwin' ? 'open' : 'xdg-open', [filePath]);
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

async function getVectorEditorPath(extended: Record<string, unknown>) {
  const editorPath = typeof extended.vectorEditorPath === 'string' ? extended.vectorEditorPath.trim() : '';
  if (!editorPath) throw new Error('Local Only: vector editor is not configured in Settings');
  if (!path.isAbsolute(editorPath)) throw new Error('Local Only: vector editor path must be an absolute path');
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

    if (action === 'export-folder') {
      const configuredExportFolder = getExtendedPath(user.settings?.defaultSubstitutions, 'lastExportDirectory', '');
      if (!outputFolderPath || !configuredExportFolder || path.resolve(outputFolderPath) !== path.resolve(configuredExportFolder)) {
        return NextResponse.json({ success: false, error: 'The export folder does not match your most recently selected export location' }, { status: 403 });
      }
      await assertExistingPath(configuredExportFolder, 'directory');
      await openFolder(configuredExportFolder);
      return NextResponse.json({ success: true, folderPath: configuredExportFolder });
    }

    if (action === 'direct-working-png') {
      const artworkId = typeof body.artworkId === 'string' ? body.artworkId : '';
      const artwork = await prisma.artwork.findFirst({
        where: { id: artworkId, userId: user.id, status: 'ACTIVE', batchItems: { none: {} } },
        include: { assets: { where: { role: 'working-png', status: 'ACTIVE' }, take: 1 } },
      });
      const png = artwork?.assets[0];
      if (!png?.filePath) return NextResponse.json({ success: false, error: 'Create the working PNG before editing it' }, { status: 404 });
      await assertExistingPath(png.filePath, 'file');
      await launchDetached(await getManualEditorPath(extended), [png.filePath]);
      return NextResponse.json({ success: true, filePath: png.filePath });
    }

    if (action === 'direct-output-folder') {
      const artworkId = typeof body.artworkId === 'string' ? body.artworkId : '';
      const artwork = await prisma.artwork.findFirst({
        where: { id: artworkId, userId: user.id, status: 'ACTIVE', batchItems: { none: {} } },
        include: { assets: { where: { role: { startsWith: 'raster-output-' }, status: 'ACTIVE' }, take: 1 } },
      });
      const output = artwork?.assets[0];
      if (!output?.filePath) return NextResponse.json({ success: false, error: 'Create an output file before opening its folder' }, { status: 404 });
      const outputFolder = path.dirname(output.filePath);
      await assertExistingPath(outputFolder, 'directory');
      await openFolder(outputFolder);
      return NextResponse.json({ success: true, folderPath: outputFolder });
    }

    if (action === 'direct-output-raster') {
      const artworkId = typeof body.artworkId === 'string' ? body.artworkId : '';
      const outputType = body.outputType === 'PNG' ? 'raster-output-png' : body.outputType === 'PNG_MASK' ? 'raster-output-png_mask' : body.outputType === 'JPG' ? 'raster-output-jpg' : null;
      if (!artworkId || !outputType) return NextResponse.json({ success: false, error: 'Choose a saved JPG, PNG, or PNG Mask output' }, { status: 400 });
      const artwork = await prisma.artwork.findFirst({ where: { id: artworkId, userId: user.id, status: 'ACTIVE', batchItems: { none: {} } }, include: { assets: { where: { role: outputType, status: 'ACTIVE' }, take: 1 } } });
      const output = artwork?.assets[0];
      if (!output?.filePath) return NextResponse.json({ success: false, error: 'Save this output before opening it in the raster editor' }, { status: 404 });
      await assertExistingPath(output.filePath, 'file');
      await launchDetached(await getManualEditorPath(extended), [output.filePath]);
      return NextResponse.json({ success: true, filePath: output.filePath });
    }

    if (action === 'direct-vector') {
      const artworkId = typeof body.artworkId === 'string' ? body.artworkId : '';
      const artwork = await prisma.artwork.findFirst({
        where: { id: artworkId, userId: user.id, status: 'ACTIVE', batchItems: { none: {} } },
        include: { assets: { where: { role: 'approved-svg', status: 'ACTIVE' }, take: 1 } },
      });
      const vector = artwork?.assets[0];
      if (!vector?.filePath) return NextResponse.json({ success: false, error: 'Save an approved vector before opening the vector editor' }, { status: 404 });
      await assertExistingPath(vector.filePath, 'file');
      await launchDetached(await getVectorEditorPath(extended), [vector.filePath]);
      return NextResponse.json({ success: true, filePath: vector.filePath });
    }

    if (action === 'original-raster') {
      const artworkId = typeof body.artworkId === 'string' ? body.artworkId : '';
      if (artworkId) {
        const artwork = await prisma.artwork.findFirst({
          where: { id: artworkId, userId: user.id, status: 'ACTIVE', batchItems: { none: {} } },
          include: { assets: { where: { role: 'source-file' }, take: 1 } },
        });
        const source = artwork?.assets[0];
        if (!artwork || !source?.filePath || !isRasterUpload(source.mimeType, source.filePath)) return NextResponse.json({ success: false, error: 'Artwork raster was not found' }, { status: 404 });
        const preparation = normalizeRasterEditorPreparation(body.preparation);
        // Always establish the persistent working JPEG before opening. This is
        // also the path used by blur/upscale preparation, so both buttons act
        // on the same selected working image.
        await ensureDirectWorkingJpeg({ userId: user.id, artworkId });
        const prepared = await prepareDirectRasterForEditor({
          userId: user.id,
          artworkId,
          preparation: body.prepare === true ? preparation : { blur: 0, upscaleFactor: 1 },
          sourceVersionKey: typeof body.sourceVersionKey === 'string' ? body.sourceVersionKey : null,
        });
        const currentSource = await prisma.asset.findFirst({ where: { artworkId, role: 'source-file', status: 'ACTIVE' } });
        const sourceMetadata = currentSource?.metadata && typeof currentSource.metadata === 'object' && !Array.isArray(currentSource.metadata)
          ? currentSource.metadata as Record<string, unknown>
          : {};
        if (currentSource) await prisma.asset.update({ where: { id: currentSource.id }, data: { metadata: { ...sourceMetadata, jpegReadyForVectorizing: false } } });
        await assertExistingPath(prepared.filePath, 'file');
        await launchDetached(await getManualEditorPath(extended), [prepared.filePath]);
        return NextResponse.json({ success: true, prepared: prepared.prepared, filePath: prepared.filePath });
      }
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

      const uploadsRoot = resolveConfiguredPath(
        getExtendedPath(user.settings?.defaultSubstitutions, 'uploadPath', config.paths.uploads)
      );
      const storageRootSetting = getExtendedPath(
        user.settings?.defaultSubstitutions,
        'storageRootPath',
        './vectorforge-storage'
      );
      const profileStorage = await configureDefaultImportStorageForUser({
        userId: user.id,
        storageRootPath: storageRootSetting,
      });
      const currentWorkingPath = path.resolve(item.uploadPath);
      if (
        !isInsideDirectory(currentWorkingPath, uploadsRoot) &&
        !(await isInsideAuthorizedProfileStorage({
          profileId: profileStorage.profile.id,
          defaultArtworkPath: profileStorage.paths.artwork,
          filePath: currentWorkingPath,
        }))
      ) {
        return NextResponse.json(
          { success: false, error: 'Working raster file is outside the current profile storage' },
          { status: 400 }
        );
      }
      try {
        await assertExistingPath(currentWorkingPath, 'file');
      } catch {
        return NextResponse.json(
          { success: false, error: 'Working raster file is missing on disk' },
          { status: 404 }
        );
      }
      const preparation = normalizeRasterEditorPreparation(body.preparation);
      const sourceVersionKey = typeof body.sourceVersionKey === 'string' ? body.sourceVersionKey : null;
      const prepared = body.prepare === true
        ? await prepareRasterForEditor({ userId: user.id, batchId, itemId, preparation, sourceVersionKey })
        : { filePath: path.resolve(item.uploadPath), prepared: false };
      const resolvedUploadPath = path.resolve(prepared.filePath);

      if (
        !isInsideDirectory(resolvedUploadPath, uploadsRoot) &&
        !(await isInsideAuthorizedProfileStorage({
          profileId: profileStorage.profile.id,
          defaultArtworkPath: profileStorage.paths.artwork,
          filePath: resolvedUploadPath,
        }))
      ) {
        return NextResponse.json(
          { success: false, error: 'Working raster file is outside the current profile storage' },
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
      await launchDetached(editorPath, [resolvedUploadPath]);
      return NextResponse.json({
        success: true,
        prepared: prepared.prepared,
        filePath: resolvedUploadPath,
      });
    }

    const configuredOutputPath = user.settings?.outputPath || config.paths.output;
    const bundleOutputPath =
      getExtendedPath(extended, 'bundleOutputPath', './output/bundles');
    const outputRoots = [
      resolveConfiguredPath(configuredOutputPath),
      resolveConfiguredPath(bundleOutputPath),
    ];
    const resolvedOutputFolder = path.resolve(outputFolderPath);

    if (!outputRoots.some((outputRoot) => isInsideDirectory(resolvedOutputFolder, outputRoot))) {
      return NextResponse.json(
        { success: false, error: 'Output folder is outside the configured output directory' },
        { status: 400 }
      );
    }

    if (action === 'folder') {
      await assertExistingPath(resolvedOutputFolder, 'directory');
      await openFolder(resolvedOutputFolder);
      return NextResponse.json({ success: true });
    }

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

    if (action === 'file' && requestedTypes.length === 0) {
      for (const filePath of requestedPaths) {
        await openFileWithDefaultApp(filePath);
      }
      return NextResponse.json({ success: true });
    }

    const editorPath = await getManualEditorPath(extended);

    for (const filePath of requestedPaths) {
      if (!outputRoots.some((outputRoot) => isInsideDirectory(filePath, outputRoot))) {
        return NextResponse.json(
          { success: false, error: 'Selected file is outside the configured output directory' },
          { status: 400 }
        );
      }
      await assertExistingPath(filePath, 'file');
    }

    const allowMultipleFiles = Boolean(extended.manualEditorAllowMultipleFiles);
    if (allowMultipleFiles) {
      await launchDetached(editorPath, requestedPaths);
    } else {
      for (const filePath of requestedPaths) {
        await launchDetached(editorPath, [filePath]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open local editor';
    logger.error('Local editor open failed', {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
