import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';

import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { getManagedArtworkDirectory } from '@/lib/artwork-storage-paths';
import { createAssetVersion } from '@/services/asset-versions';
import { getWritableStorageLocationForFile } from '@/services/raster-editor-preparation';
import { exportRasterOutputs, type RasterOutputSpecification } from '@/services/raster-output';
import { configureDefaultImportStorageForUser } from '@/services/profile-storage';
import { createCoreCommand } from '@/services/sema-core';
import { issueSemaIdentifier } from '@/services/sema-core-identity';
import { semaLocalToken } from '@/lib/sema-id';
import { isHexColor } from '@/lib/tuning-defaults';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function outputMaskColor(defaultSubstitutions: unknown) {
  const configured = asRecord(defaultSubstitutions).pngExportArtworkColor;
  return isHexColor(configured) ? configured : config.processing.pngExportArtworkColor;
}

function outputDirectoryFor(workingPath: string) {
  const artworkDirectory = getManagedArtworkDirectory(workingPath);
  if (!artworkDirectory) throw new Error('Artwork has no managed directory');
  return path.join(artworkDirectory, 'vectorforge', 'output');
}

function outputRole(format: string) {
  return `raster-output-${format.toLowerCase()}`;
}

function outputExtension(format: 'JPG' | 'PNG' | 'PNG_MASK' | 'PDF') {
  return format === 'JPG' ? '.jpg' : format === 'PNG_MASK' ? '-mask.png' : format === 'PNG' ? '.png' : '.pdf';
}

async function archiveCurrentOutputPaths(input: {
  artwork: { assets: Array<{ id: string; role: string }> };
  formats: Array<'JPG' | 'PNG' | 'PNG_MASK' | 'PDF'>;
  outputDirectory: string;
  baseName: string;
  outputToken: string;
  profileId: string;
  workspaceId: string | null;
  defaultLocation: { id: string; basePath: string };
}) {
  for (const format of input.formats) {
    const asset = input.artwork.assets.find((candidate) => candidate.role === outputRole(format));
    if (!asset) continue;
    const currentPath = path.join(input.outputDirectory, `${input.baseName}${outputExtension(format)}`);
    const location = await getWritableStorageLocationForFile({
      profileId: input.profileId,
      workspaceId: input.workspaceId,
      defaultLocation: input.defaultLocation,
      filePath: currentPath,
    });
    const relativePath = path.relative(location.basePath, currentPath).split(path.sep).join('/');
    const occupied = await prisma.assetLocation.findFirst({
      where: { storageLocationId: location.id, relativePath, assetVersion: { assetId: asset.id } },
      include: { assetVersion: { select: { versionNumber: true } } },
    });
    if (!occupied) continue;
    const archivePath = path.join(
      input.outputDirectory,
      `${input.baseName}-${format.toLowerCase().replace('_', '-')}-v${String(occupied.assetVersion.versionNumber).padStart(4, '0')}-${input.outputToken}${outputExtension(format)}`,
    );
    await rename(currentPath, archivePath);
    await prisma.assetLocation.update({
      where: { id: occupied.id },
      data: { relativePath: path.relative(location.basePath, archivePath).split(path.sep).join('/') },
    });
  }
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
  const auditSpecification: Prisma.InputJsonObject = {
    constrainBy: input.specification.constrainBy,
    value: input.specification.value,
    unit: input.specification.unit,
    dpi: input.specification.dpi,
    formats: [...input.specification.formats],
  };
  const command = await createCoreCommand({
    commandType: 'vectorforge.raster-output.export',
    actorId: input.userId,
    workspaceId: artwork.workspaceId,
    subjectIds: [artwork.id, source.id],
    payload: { specification: auditSpecification },
  });

  try {
    const outputDirectory = outputDirectoryFor(source.filePath);
    const outputBaseName = artwork.outputBaseName || artwork.title;
    const outputToken = semaLocalToken(command.id);
    await archiveCurrentOutputPaths({
      artwork,
      formats: input.specification.formats,
      outputDirectory,
      baseName: outputBaseName,
      outputToken,
      profileId: storage.profile.id,
      workspaceId: artwork.workspaceId,
      defaultLocation: storage.location,
    });
    const result = await exportRasterOutputs({
      sourcePath: source.filePath,
      outputDirectory,
      baseName: outputBaseName,
      spec: { ...input.specification, maskColor: outputMaskColor(user.settings?.defaultSubstitutions) },
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
      const metadata: Prisma.InputJsonObject = {
        outputKind: 'RASTER_EXPORT',
        format: output.format,
        completion: 'COMPLETED',
        specification: auditSpecification,
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
