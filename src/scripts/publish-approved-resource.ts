/** Publish one already-approved VectorForge AssetVersion to the independent Foundation Resource service. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import prisma from '@/lib/prisma';

const assetVersionId = process.argv[2];
if (!assetVersionId) throw new Error('Usage: npm run sema:resources:publish -- <AssetVersionId>');
const resource = await prisma.assetVersion.findUnique({
  where: { assetVersionId },
  include: { asset: { include: { owner: true, workspace: true, artwork: true } }, locations: { where: { status: 'AVAILABLE' }, include: { storageLocation: true }, take: 1 } },
});
if (!resource || resource.status !== 'APPROVED') throw new Error('Only an approved AssetVersion may be published.');
const location = resource.locations[0];
if (!location) throw new Error('Approved AssetVersion has no available storage location.');
const contents = await readFile(resolve(location.storageLocation.basePath, location.relativePath));
const endpoint = `${(process.env.SEMA_RESOURCE_URL ?? process.env.SEMA_RESOURCE_FACILITY_URL ?? 'http://127.0.0.1:4330').replace(/\/$/, '')}/v1/resources/publish`;
const metadata = {
  resourceId: resource.asset.assetId, resourceVersionId: resource.assetVersionId,
  workspaceId: resource.asset.workspace.workspaceId, ownerId: resource.asset.owner.ownerId,
  title: resource.asset.artwork.title, role: resource.asset.role, mimeType: resource.mimeType ?? resource.asset.mimeType ?? 'application/octet-stream',
  source: { applicationKey: 'vectorforge', assetId: resource.asset.assetId, assetVersionId: resource.assetVersionId },
};
const response = await fetch(endpoint, { method: 'POST', headers: { 'x-sema-admin-key': process.env.SEMA_RESOURCE_ADMIN_KEY ?? '', 'x-sema-resource': Buffer.from(JSON.stringify(metadata)).toString('base64url'), 'content-type': metadata.mimeType }, body: contents });
if (!response.ok) throw new Error(`Resource publish failed (${response.status}): ${await response.text()}`);
console.log(`Published ${resource.assetVersionId} to Foundation Resource.`);
