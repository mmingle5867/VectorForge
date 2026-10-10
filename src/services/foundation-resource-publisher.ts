import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import prisma from '@/lib/prisma';

// SEMA_RESOURCE_FACILITY_URL is the former name and is still accepted.
const resourceUrl = () => (process.env.SEMA_RESOURCE_URL ?? process.env.SEMA_RESOURCE_FACILITY_URL ?? 'http://127.0.0.1:4330').replace(/\/$/, '');
const resourceKey = () => process.env.SEMA_RESOURCE_ADMIN_KEY ?? '';

async function publishVersion(assetVersionId: string, expectedUserId: string) {
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

/** Publish selected current approved outputs without creating a consumer access grant. */
export async function publishArtworkToSharedResources(input: { artworkId: string; userId: string; assetVersionIds?: string[] }) {
  const artwork = await prisma.artwork.findFirst({ where: { id: input.artworkId, userId: input.userId, status: 'ACTIVE' } });
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
  const published = [];
  for (const assetVersionId of selectedIds) published.push(await publishVersion(assetVersionId, input.userId));
  return { published, access: 'PENDING_SEMA_ACCESS_POLICY' as const };
}
