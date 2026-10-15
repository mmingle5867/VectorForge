import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import prisma from '@/lib/prisma';

// SEMA_RESOURCE_FACILITY_URL is the former name and is still accepted.
const resourceUrl = () => (process.env.SEMA_RESOURCE_URL ?? process.env.SEMA_RESOURCE_FACILITY_URL ?? 'http://127.0.0.1:4330').replace(/\/$/, '');
const resourceKey = () => process.env.SEMA_RESOURCE_ADMIN_KEY ?? '';

/** The artwork's categories as they are now: ID, name and the names from the top of the tree down to it. */
async function sharedCategories(itemId: string | null) {
  if (!itemId) return [];
  const assigned = await prisma.itemCategory.findMany({ where: { itemId }, include: { category: true }, orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'asc' }] });
  const result: Array<{ categoryId: string; name: string; path: string[] }> = [];
  for (const { category } of assigned) {
    if (category.status !== 'ACTIVE') continue;
    const path = [category.name];
    const seen = new Set([category.id]);
    for (let parentId = category.parentId; parentId && !seen.has(parentId); ) {
      seen.add(parentId);
      const parent = await prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) break;
      path.unshift(parent.name);
      parentId = parent.parentId;
    }
    result.push({ categoryId: category.categoryId, name: category.name, path });
  }
  return result;
}

/**
 * Saves the share's group in Foundation Resource: the artwork it came from (its ID is the group's ID, so sharing again
 * updates the same group), its title, its description and its categories as they are now.
 */
async function saveGroup(artwork: { id: string; title: string; description: string | null; itemId: string | null; ownerId: string | null; workspaceId: string | null }) {
  if (!artwork.ownerId || !artwork.workspaceId) throw new Error('This artwork has no owner or workspace, so it cannot be shared.');
  const group = { groupId: artwork.id, workspaceId: artwork.workspaceId, ownerId: artwork.ownerId, title: artwork.title, ...(artwork.description ? { description: artwork.description } : {}), categories: await sharedCategories(artwork.itemId), source: { applicationKey: 'vectorforge', artworkId: artwork.id } };
  const response = await fetch(`${resourceUrl()}/v1/resources/groups`, { method: 'POST', headers: { 'x-sema-admin-key': resourceKey(), 'content-type': 'application/json' }, body: JSON.stringify(group) });
  if (!response.ok) throw new Error(`Saving the shared group failed (${response.status}): ${await response.text()}`);
  return group;
}

async function publishVersion(assetVersionId: string, expectedUserId: string, groupId: string) {
  const version = await prisma.assetVersion.findUnique({
    where: { assetVersionId },
    include: {
      asset: { include: { owner: true, workspace: true, artwork: true } },
      locations: { where: { status: 'AVAILABLE' }, include: { storageLocation: true }, take: 1 },
    },
  });
  if (!version || version.status !== 'APPROVED') throw new Error('Only approved asset versions may be published.');
  if (version.asset.artwork?.userId !== expectedUserId) throw new Error('You are not allowed to publish this artwork.');
  const location = version.locations[0];
  if (!location) throw new Error('Approved asset version has no available storage location.');
  const metadata = {
    resourceId: version.asset.assetId,
    resourceVersionId: version.assetVersionId,
    workspaceId: version.asset.workspace.workspaceId,
    ownerId: version.asset.owner.ownerId,
    title: version.asset.artwork?.title ?? version.asset.assetId,
    role: version.asset.role,
    mimeType: version.mimeType ?? version.asset.mimeType ?? 'application/octet-stream',
    source: { applicationKey: 'vectorforge', assetId: version.asset.assetId, assetVersionId: version.assetVersionId },
    groupId,
  };
  const response = await fetch(`${resourceUrl()}/v1/resources/publish`, {
    method: 'POST',
    headers: {
      'x-sema-admin-key': resourceKey(),
      'x-sema-resource': Buffer.from(JSON.stringify(metadata)).toString('base64url'),
      'content-type': metadata.mimeType,
    },
    body: await readFile(resolve(location.storageLocation.basePath, location.relativePath)),
  });
  if (!response.ok) throw new Error(`Resource publish failed (${response.status}): ${await response.text()}`);
  return { assetId: version.asset.assetId, assetVersionId: version.assetVersionId, title: metadata.title, role: metadata.role };
}

/**
 * Shares selected current approved outputs of one artwork with Foundation Resource, as one group: the artwork's
 * description (saved on the artwork first, when one is given) and its categories go with them. No consumer access
 * grant is created here.
 */
export async function publishArtworkToSharedResources(input: { artworkId: string; userId: string; assetVersionIds?: string[]; description?: string | null }) {
  let artwork = await prisma.artwork.findFirst({ where: { id: input.artworkId, userId: input.userId, status: 'ACTIVE' } });
  if (!artwork) throw new Error('Artwork was not found.');
  const versions = await prisma.assetVersion.findMany({
    where: { status: 'APPROVED', asset: { artworkId: artwork.id, status: 'ACTIVE' } },
    orderBy: { createdAt: 'desc' },
    distinct: ['assetId'],
    select: { assetVersionId: true },
  });
  if (!versions.length) throw new Error('Finalize approved SVG, PNG, or JPG outputs before publishing.');
  const selectedIds = input.assetVersionIds ? [...new Set(input.assetVersionIds)] : versions.map((version) => version.assetVersionId);
  if (!selectedIds.length) throw new Error('Choose at least one approved file to publish.');
  const eligibleIds = new Set(versions.map((version) => version.assetVersionId));
  if (selectedIds.some((assetVersionId) => !eligibleIds.has(assetVersionId))) throw new Error('One or more selected files are not current approved outputs for this artwork. Refresh the list and try again.');
  if (input.description !== undefined) {
    const description = typeof input.description === 'string' && input.description.trim() ? input.description.trim().slice(0, 20_000) : null;
    artwork = await prisma.artwork.update({ where: { id: artwork.id }, data: { description } });
  }
  const group = await saveGroup(artwork);
  const published = [];
  for (const assetVersionId of selectedIds) published.push(await publishVersion(assetVersionId, input.userId, group.groupId));
  return { published, group: { groupId: group.groupId, description: group.description ?? null, categories: group.categories }, access: 'PENDING_SEMA_ACCESS_POLICY' as const };
}

/** What a share of this artwork would carry besides its files: its description and its categories as they are now. */
export async function sharePreview(input: { artworkId: string; userId: string }) {
  const artwork = await prisma.artwork.findFirst({ where: { id: input.artworkId, userId: input.userId, status: 'ACTIVE' } });
  if (!artwork) throw new Error('Artwork was not found.');
  return { description: artwork.description ?? '', categories: await sharedCategories(artwork.itemId) };
}
