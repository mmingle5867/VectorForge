import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getManagedArtworkDirectory, remapPathWithinDirectory } from '@/lib/artwork-storage-paths';
import { withArtworkMutationLock } from '@/lib/artwork-mutation-lock';
import prisma from '@/lib/prisma';
import { semaLocalToken } from '@/lib/sema-id';
import { reserveAvailableDirectoryName, reserveAvailableNumberedDirectoryName } from '@/services/artwork-ingest';
import { createCoreCommand } from '@/services/sema-core';

function safeBaseName(value: string) {
  const result = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/g, '').slice(0, 160);
  if (!result || result === '.' || result === '..') throw new Error('Enter a valid filename');
  return result;
}

async function exists(filePath: string) {
  try { await access(filePath); return true; } catch { return false; }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(filePath) : [filePath];
  }))).flat();
}

function renamedLeaf(name: string, oldStems: string[], newBaseName: string) {
  const parsed = path.parse(name);
  const oldStem = oldStems.find((stem) => {
    const current = parsed.name.toLowerCase();
    const candidate = stem.toLowerCase();
    return current === candidate || current.startsWith(`${candidate}-`) || current.startsWith(`${candidate}_`);
  });
  return oldStem ? `${newBaseName}${parsed.name.slice(oldStem.length)}${parsed.ext}` : name;
}

async function reserveSiblingFilePath(filePath: string) {
  const parsed = path.parse(filePath);
  for (let index = 1; ; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${String(index).padStart(4, '0')}${parsed.ext}`);
    if (!(await exists(candidate))) return candidate;
  }
}

async function ownedArtwork(userId: string, artworkId: string) {
  const artwork = await prisma.artwork.findFirst({
    where: { id: artworkId, userId, status: 'ACTIVE', batchItems: { none: {} } },
    include: { item: true, assets: { include: { versions: { include: { locations: { include: { storageLocation: true } } } } } } },
  });
  if (!artwork) throw new Error('Artwork was not found');
  const working = artwork.assets.find((asset) => asset.role === 'source-file');
  const directory = getManagedArtworkDirectory(working?.filePath);
  if (!working?.filePath || !directory) throw new Error('Artwork has no managed working directory');
  return { artwork, working, directory };
}

export async function renameDirectArtwork(input: { userId: string; artworkId: string; newBaseName: string; allocatedName?: string }) {
  return withArtworkMutationLock(input.artworkId, 'renamed', async () => {
    const { artwork, working, directory } = await ownedArtwork(input.userId, input.artworkId);
    const profile = await prisma.semaProfile.findFirst({ where: { userId: input.userId, status: 'ACTIVE' } });
    if (!profile) throw new Error('Active SEMA profile was not found');
    const requested = safeBaseName(input.newBaseName);
    const allocated = input.allocatedName
      ? safeBaseName(input.allocatedName)
      : await reserveAvailableDirectoryName(profile.id, requested, path.dirname(directory));
    const target = path.join(path.dirname(directory), allocated);
    const command = await createCoreCommand({ commandType: 'vectorforge.artwork.rename', actorId: input.userId, subjectIds: [artwork.id, working.id], payload: { requested, allocated } });
    const staged = path.join(path.dirname(directory), `.rename-${semaLocalToken(command.id)}`);
    const relativeRenames = new Map<string, string>();
    await cp(directory, staged, { recursive: true, errorOnExist: true, force: false });
    try {
      const oldStems = [path.parse(working.filePath!).name, path.basename(directory), artwork.title].filter((value): value is string => Boolean(value));
      const plan = (await listFiles(staged)).sort().map((filePath, index) => ({
        filePath,
        index,
        nextName: renamedLeaf(path.basename(filePath), oldStems, allocated),
      })).filter((entry) => entry.nextName !== path.basename(entry.filePath));

      // Move all sources out of the way first. Historical working files can
      // have names that overlap one another after a human-facing rename.
      // A two-pass rename prevents a source from being mistaken for a target.
      const stagedPlan = [] as Array<{ filePath: string; temporaryPath: string; nextName: string }>;
      for (const entry of plan) {
        const temporaryPath = path.join(
          path.dirname(entry.filePath),
          `.vf-rename-${semaLocalToken(command.id)}-${entry.index}${path.extname(entry.filePath)}`
        );
        if (await exists(temporaryPath)) throw new Error('A temporary rename file already exists; try rename again');
        await rename(entry.filePath, temporaryPath);
        stagedPlan.push({ filePath: entry.filePath, temporaryPath, nextName: entry.nextName });
      }
      for (const entry of stagedPlan) {
        let nextPath = path.join(path.dirname(entry.filePath), entry.nextName);
        if (await exists(nextPath)) nextPath = await reserveSiblingFilePath(nextPath);
        await rename(entry.temporaryPath, nextPath);
        relativeRenames.set(path.relative(staged, entry.filePath), path.relative(staged, nextPath));
      }
      await rename(staged, target);
      for (const jsonPath of (await listFiles(target)).filter((filePath) => path.extname(filePath).toLowerCase() === '.json')) {
        try {
          const current = await readFile(jsonPath, 'utf8');
          const updated = current.split(directory).join(target).split(path.basename(directory)).join(allocated);
          if (updated !== current) await writeFile(jsonPath, updated, 'utf8');
        } catch { /* Database paths remain authoritative. */ }
      }
    } catch (error) { await rm(staged, { recursive: true, force: true }); throw error; }
    const remap = (value: string | null) => remapPathWithinDirectory(value, directory, target, relativeRenames);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.artwork.update({ where: { id: artwork.id }, data: { title: allocated, outputBaseName: allocated } });
        if (artwork.item) await tx.item.update({ where: { id: artwork.item.id }, data: { title: allocated } });
        for (const asset of artwork.assets) {
          const filePath = remap(asset.filePath);
          await tx.asset.update({ where: { id: asset.id }, data: { filePath } });
          for (const version of asset.versions) for (const location of version.locations) {
            const absolute = path.resolve(location.storageLocation.basePath, location.relativePath);
            const next = remap(absolute);
            if (next && next !== absolute) await tx.assetLocation.update({ where: { id: location.id }, data: { relativePath: path.relative(location.storageLocation.basePath, next).split(path.sep).join('/') } });
          }
        }
        await tx.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
      });
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined);
      throw error;
    }
    await rm(directory, { recursive: true, force: true });
    return { baseName: allocated, directory: target };
  });
}

function isNumberedNameForBase(value: string, baseName: string) {
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedBase}-\\d{4}$`, 'i').test(value);
}

export async function batchRenameDirectArtwork(input: { userId: string; artworkIds: string[]; newBaseName: string }) {
  const requested = safeBaseName(input.newBaseName);
  const uniqueIds = [...new Set(input.artworkIds)];
  if (!uniqueIds.length) throw new Error('Select at least one artwork');
  const profile = await prisma.semaProfile.findFirst({ where: { userId: input.userId, status: 'ACTIVE' } });
  if (!profile) throw new Error('Active SEMA profile was not found');

  const currentArtworks = await prisma.artwork.findMany({
    where: { userId: input.userId, status: 'ACTIVE' },
    select: { id: true, title: true },
  });
  const titlesById = new Map(currentArtworks.map((artwork) => [artwork.id, artwork.title]));
  const unavailableNames = new Set(currentArtworks.map((artwork) => artwork.title.trim().normalize('NFKC').toLocaleLowerCase('en-US')));
  const renamed: Array<{ artworkId: string; baseName: string }> = [];
  const skipped: Array<{ artworkId: string; baseName: string; reason: string }> = [];
  const failures: Array<{ artworkId: string; reason: string }> = [];

  for (const artworkId of uniqueIds) {
    const currentTitle = titlesById.get(artworkId);
    if (!currentTitle) {
      failures.push({ artworkId, reason: 'Artwork was not found' });
      continue;
    }
    if (isNumberedNameForBase(currentTitle, requested)) {
      skipped.push({ artworkId, baseName: currentTitle, reason: 'Already has a numbered name for this batch base' });
      continue;
    }
    try {
      const current = await ownedArtwork(input.userId, artworkId);
      const allocated = await reserveAvailableNumberedDirectoryName(
        profile.id,
        requested,
        path.dirname(current.directory),
        unavailableNames,
      );
      const result = await renameDirectArtwork({
        userId: input.userId,
        artworkId,
        newBaseName: requested,
        allocatedName: allocated,
      });
      renamed.push({ artworkId, baseName: result.baseName });
    } catch (error) {
      failures.push({ artworkId, reason: error instanceof Error ? error.message : 'Rename failed' });
    }
  }
  return { renamed, skipped, failures };
}

export async function deleteDirectArtwork(input: { userId: string; artworkId: string }) {
  return withArtworkMutationLock(input.artworkId, 'deleted', async () => {
    const { artwork, directory } = await ownedArtwork(input.userId, input.artworkId);
    const command = await createCoreCommand({ commandType: 'vectorforge.artwork.delete', actorId: input.userId, subjectIds: [artwork.id, ...artwork.assets.map((asset) => asset.id)] });
    const trash = path.join(path.dirname(path.dirname(directory)), '.trash', 'artwork', `${path.basename(directory)}-${semaLocalToken(command.id)}`);
    await mkdir(path.dirname(trash), { recursive: true });
    await rename(directory, trash);
    try {
      await prisma.$transaction(async (tx) => {
        for (const asset of artwork.assets) {
          await tx.asset.update({ where: { id: asset.id }, data: { status: 'RETIRED', filePath: remapPathWithinDirectory(asset.filePath, directory, trash) } });
          await tx.assetVersion.updateMany({ where: { assetId: asset.id }, data: { status: 'RETIRED' } });
          for (const version of asset.versions) for (const location of version.locations) {
            const previousAbsolute = path.resolve(location.storageLocation.basePath, location.relativePath);
            const nextAbsolute = remapPathWithinDirectory(previousAbsolute, directory, trash);
            if (nextAbsolute) await tx.assetLocation.update({ where: { id: location.id }, data: { relativePath: path.relative(location.storageLocation.basePath, nextAbsolute).split(path.sep).join('/') } });
          }
        }
        if (artwork.item) { await tx.itemCategory.deleteMany({ where: { itemId: artwork.item.id } }); await tx.item.update({ where: { id: artwork.item.id }, data: { status: 'RETIRED' } }); }
        await tx.artwork.update({ where: { id: artwork.id }, data: { status: 'RETIRED' } });
        await tx.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'SUCCESS' } });
      });
    } catch (error) {
      await rename(trash, directory).catch(() => undefined);
      await prisma.semaCoreCommand.update({ where: { id: command.id }, data: { status: 'FAILED' } }).catch(() => undefined);
      throw error;
    }
    return { recoverableTrashPath: trash };
  });
}
