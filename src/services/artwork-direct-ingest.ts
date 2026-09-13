import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { GRAPHICS_CAPABILITIES, resolveLocalGraphicsCapability } from '@/capabilities/graphics/registry';
import prisma from '@/lib/prisma';
import { semaLocalToken } from '@/lib/sema-id';
import { createAssetVersion } from '@/services/asset-versions';
import { reserveAvailableDirectoryName } from '@/services/artwork-ingest';
import { configureDefaultImportStorageForUser, getVectorForgeStoragePaths } from '@/services/profile-storage';
import { createArtworkSemaContext } from '@/services/sema-identity';
import { createCoreCommand } from '@/services/sema-core';

const SUPPORTED_EXTENSIONS = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.tif', 'image/tiff'], ['.tiff', 'image/tiff'],
  ['.svg', 'image/svg+xml'],
]);

function safeFilename(value: string) {
  const leaf = path.basename(value).trim();
  const ext = path.extname(leaf).toLowerCase();
  const stem = leaf.slice(0, Math.max(0, leaf.length - ext.length))
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '').trim() || 'artwork';
  return `${stem.slice(0, 180)}${ext}`;
}

function baseName(filename: string) {
  return path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9_-]/g, '_') || 'artwork';
}

function relative(base: string, target: string) {
  return path.relative(base, target).split(path.sep).join('/');
}

/** The fixed, copy-first layout for an artwork-first import. */
export function getDirectArtworkLayout(artworkRoot: string, directoryName: string, filename: string) {
  const directory = path.join(artworkRoot, directoryName);
  return {
    directory,
    original: path.join(directory, 'original', filename),
    working: path.join(directory, 'vectorforge', 'working', filename),
    manifest: path.join(directory, 'vectorforge', 'manifest', 'manifest.json'),
  };
}

async function hashFile(filePath: string) {
  const content = await readFile(filePath);
  return { sha256: createHash('sha256').update(content).digest('hex'), byteLength: content.byteLength };
}

export type DirectArtworkIngestInput = { stagedPath: string; originalFilename: string; mimeType?: string | null };

export async function ingestArtworkDirect(input: { userId: string; files: DirectArtworkIngestInput[] }) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId }, include: { settings: true },
  });
  if (!user) throw new Error('User not found');
  const settings = user.settings?.defaultSubstitutions;
  const storageRootPath = settings && typeof settings === 'object' && !Array.isArray(settings)
    && typeof (settings as Record<string, unknown>).storageRootPath === 'string'
    ? (settings as Record<string, string>).storageRootPath
    : undefined;
  const storage = await configureDefaultImportStorageForUser({ userId: input.userId, storageRootPath });
  const paths = getVectorForgeStoragePaths(storage.location.basePath);
  const files = [] as Array<{ artworkId: string; itemId: string; originalFilename: string; baseName: string; previewUrl: string }>;
  const errors = [] as Array<{ filename: string; error: string }>;

  for (const staged of input.files) {
    try {
      const requestedFilename = safeFilename(staged.originalFilename);
      const extension = path.extname(requestedFilename);
      const mimeType = staged.mimeType || SUPPORTED_EXTENSIONS.get(extension) || null;
      if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Unsupported file type: ${requestedFilename}`);
      await resolveLocalGraphicsCapability(GRAPHICS_CAPABILITIES.rasterTransform, { actorId: input.userId, workspaceId: storage.workspace.id });
      const requestedName = baseName(requestedFilename);
      const directoryName = await reserveAvailableDirectoryName(storage.profile.id, requestedName, paths.artwork);
      // A collision changes both the managed directory and the visible file
      // name. This prevents two independent artworks from presenting the same
      // filename even though their permanent SEMA identities differ.
      const filename = directoryName === requestedName ? requestedFilename : `${directoryName}${extension}`;
      const layout = getDirectArtworkLayout(paths.artwork, directoryName, filename);
      const finalDirectory = layout.directory;
      const context = await createArtworkSemaContext({
        userId: input.userId, title: directoryName,
        originalFilePath: layout.original,
        workingFilePath: layout.working,
        mimeType,
      });
      const command = await createCoreCommand({ commandType: 'vectorforge.artwork.ingest', actorId: input.userId, workspaceId: storage.workspace.id, subjectIds: [context.artwork.id] });
      // The temporary directory is named from a Core-issued Command KeyID. It
      // is not a UUID/CUID or an application-local counter.
      const temporaryDirectory = path.join(paths.artwork, `.ingest-${semaLocalToken(command.id)}`);
      const originalPath = layout.original;
      const workingPath = layout.working;
      try {
        await Promise.all([
          mkdir(path.join(temporaryDirectory, 'original'), { recursive: true }),
          mkdir(path.join(temporaryDirectory, 'vectorforge', 'working'), { recursive: true }),
          mkdir(path.join(temporaryDirectory, 'vectorforge', 'vectorized'), { recursive: true }),
          mkdir(path.join(temporaryDirectory, 'vectorforge', 'png'), { recursive: true }),
          mkdir(path.join(temporaryDirectory, 'vectorforge', 'jpg'), { recursive: true }),
          mkdir(path.join(temporaryDirectory, 'vectorforge', 'manifest'), { recursive: true }),
        ]);
        await copyFile(staged.stagedPath, path.join(temporaryDirectory, 'original', filename));
        await copyFile(path.join(temporaryDirectory, 'original', filename), path.join(temporaryDirectory, 'vectorforge', 'working', filename));
        await rename(temporaryDirectory, finalDirectory);
        const digest = await hashFile(workingPath);
        await createAssetVersion({ assetId: context.originalAsset.id, createdByProfileId: storage.profile.id, storageLocationId: storage.location.id, relativePath: relative(storage.location.basePath, originalPath), ...digest, mimeType, status: 'APPROVED', verifiedAt: new Date(), metadata: { role: 'original-file', immutableSource: true } });
        await createAssetVersion({ assetId: context.workingAsset.id, createdByProfileId: storage.profile.id, storageLocationId: storage.location.id, relativePath: relative(storage.location.basePath, workingPath), ...digest, mimeType, status: 'DRAFT', verifiedAt: new Date(), metadata: { role: 'working-copy', derivedFromAssetId: context.originalAsset.assetId } });
        const dimensions = await sharp(workingPath).metadata().catch(() => null);
        await writeFile(layout.manifest, `${JSON.stringify({ manifestType: 'VECTORFORGE.ARTWORK', manifestVersion: 2, references: { itemId: context.item.itemId, artworkId: context.artwork.artworkNumber, originalAssetId: context.originalAsset.assetId, workingAssetId: context.workingAsset.assetId }, files: { original: relative(finalDirectory, originalPath), working: relative(finalDirectory, workingPath) }, dimensions: dimensions ? { width: dimensions.width ?? null, height: dimensions.height ?? null } : null, createdAt: new Date().toISOString() }, null, 2)}\n`);
        await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
        await unlink(staged.stagedPath).catch(() => undefined);
        files.push({ artworkId: context.artwork.id, itemId: context.item.id, originalFilename: filename, baseName: directoryName, previewUrl: `/api/artwork/${context.artwork.id}/preview` });
      } catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
        await rm(finalDirectory, { recursive: true, force: true }).catch(() => undefined);
        await prisma.$transaction(async (tx) => {
          await tx.artwork.delete({ where: { id: context.artwork.id } }).catch(() => undefined);
          await tx.item.delete({ where: { id: context.item.id } }).catch(() => undefined);
          await tx.semaCoreCommand.update({
            where: { id: command.id },
            data: { status: 'FAILED' },
          }).catch(() => undefined);
        }).catch(() => undefined);
        throw error;
      }
    } catch (error) { errors.push({ filename: staged.originalFilename, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { files, errors, storage: paths };
}

/** Import stable, visible files that were placed in the watched processing folder. */
export async function scanArtworkDirectProcessingFolder(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { settings: true } });
  if (!user) throw new Error('User not found');
  const setting = user.settings?.defaultSubstitutions;
  const storageRootPath = setting && typeof setting === 'object' && !Array.isArray(setting)
    && typeof (setting as Record<string, unknown>).storageRootPath === 'string'
    ? (setting as Record<string, string>).storageRootPath
    : undefined;
  const storage = await configureDefaultImportStorageForUser({ userId, storageRootPath });
  const paths = getVectorForgeStoragePaths(storage.location.basePath);
  await mkdir(paths.processing, { recursive: true });
  const entries = await readdir(paths.processing, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => ({ stagedPath: path.join(paths.processing, entry.name), originalFilename: entry.name, mimeType: SUPPORTED_EXTENSIONS.get(path.extname(entry.name).toLowerCase()) ?? null }));
  if (!candidates.length) return { files: [], errors: [], storage: paths };
  return ingestArtworkDirect({ userId, files: candidates });
}
