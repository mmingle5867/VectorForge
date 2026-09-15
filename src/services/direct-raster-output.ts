import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import prisma from '@/lib/prisma';
import { getManagedArtworkDirectory } from '@/lib/artwork-storage-paths';
import { createAssetVersion } from '@/services/asset-versions';
import { getWritableStorageLocationForFile } from '@/services/raster-editor-preparation';
import { exportRasterOutputs, type RasterOutputSpecification } from '@/services/raster-output';
import { configureDefaultImportStorageForUser } from '@/services/profile-storage';
import { createCoreCommand } from '@/services/sema-core';
import { issueSemaIdentifier } from '@/services/sema-core-identity';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function outputDirectoryFor(workingPath: string) {
  const artworkDirectory = getManagedArtworkDirectory(workingPath);
  if (!artworkDirectory) throw new Error('Artwork has no managed directory');
  return path.join(artworkDirectory, 'vectorforge', 'output');
}

function outputRole(format: string) {
  return `raster-output-${format.toLowerCase()}`;
}

/**
 * Creates generic, reusable raster outputs. The artwork's vector review state
 * is deliberately not changed: an output is complete only for its own format
 * and technical specification.
 */
export async function exportDirectArtworkRasterOutputs(input: {
  userId: string;
  artworkId: string;
  specification: RasterOutputSpecification;
}) {
  const artwork = await prisma.artwork.findFirst({
    where: { id: input.artworkId, userId: input.userId, status: 'ACTIVE', batchItems: { none: {} } },
    include: { assets: { where: { status: 'ACTIVE' } } },
  });
  const source = artwork?.assets.find((asset) => asset.role === 'source-file' && asset.filePath);
  if (!artwork || !source?.filePath) throw new Error('Working artwork was not found');

  const user = await prisma.user.findUnique({ where: { id: input.userId }, include: { settings: true } });
  if (!user) throw new Error('User was not found');
  const configuredRoot = asRecord(user.settings?.defaultSubstitutions).storageRootPath;
  const storage = await configureDefaultImportStorageForUser({
    userId: input.userId,
    storageRootPath: typeof configuredRoot === 'string' && configuredRoot.trim() ? configuredRoot : undefined,
  });
  const command = await createCoreCommand({
    commandType: 'vectorforge.raster-output.export',
    actorId: input.userId,
    workspaceId: artwork.workspaceId,
    subjectIds: [artwork.id, source.id],
    payload: { specification: input.specification },
  });

  try {
    const result = await exportRasterOutputs({
      sourcePath: source.filePath,
      outputDirectory: outputDirectoryFor(source.filePath),
      baseName: artwork.outputBaseName || artwork.title,
      spec: input.specification,
    });
    const assets = [];
    for (const output of result.outputs) {
      const contents = await readFile(output.path);
      const location = await getWritableStorageLocationForFile({
        profileId: storage.profile.id,
        workspaceId: artwork.workspaceId,
        defaultLocation: storage.location,
        filePath: output.path,
      });
      const existing = artwork.assets.find((asset) => asset.role === outputRole(output.format));
      const metadata = {
        outputKind: 'RASTER_EXPORT',
        format: output.format,
        completion: 'COMPLETED',
        specification: input.specification,
        pixels: { width: result.dimensions.width, height: result.dimensions.height },
        physicalSize: { widthInches: result.dimensions.inchesWide, heightInches: result.dimensions.inchesHigh },
        derivedFromAssetId: source.assetId,
      };
      const asset = existing
        ? await prisma.asset.update({
            where: { id: existing.id },
            data: { filePath: output.path, mimeType: output.mimeType, metadata },
          })
        : await (async () => {
            const identifier = await issueSemaIdentifier('AST', { purpose: 'raster-output', format: output.format, artworkId: artwork.artworkNumber });
            return prisma.asset.create({
              data: {
                id: identifier.id, assetId: identifier.id, ownerId: artwork.ownerId!, workspaceId: artwork.workspaceId!,
                itemId: artwork.itemId!, artworkId: artwork.id, role: outputRole(output.format),
                filePath: output.path, mimeType: output.mimeType, metadata,
              },
            });
          })();
      await createAssetVersion({
        assetId: asset.id, createdByProfileId: storage.profile.id, storageLocationId: location.id,
        relativePath: path.relative(location.basePath, output.path).split(path.sep).join('/'),
        sha256: createHash('sha256').update(contents).digest('hex'), byteLength: contents.byteLength,
        mimeType: output.mimeType, status: 'APPROVED', verifiedAt: new Date(), metadata,
      });
      assets.push({ assetId: asset.assetId, format: output.format, path: output.path });
    }
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
    return { dimensions: result.dimensions, assets };
  } catch (error) {
    await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined);
    throw error;
  }
}
