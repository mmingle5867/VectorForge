import { WorkspaceMemberStatus, WorkspaceRole } from '@prisma/client';

import config from '@/lib/config';
import prisma from '@/lib/prisma';
import { issueSemaIdentifier } from '@/services/sema-core-identity';

export interface SemaAccessContext {
  userId: string;
  profileId: string;
  ownerId: string;
  workspaceId: string;
  workspaceMembershipId: string;
  role: WorkspaceRole;
}

/**
 * Creates the local-first ownership and membership records required for a user
 * to operate through the same context model that later multi-user mode uses.
 */
export async function ensureLocalSemaAccessContext(userId: string): Promise<SemaAccessContext> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  let owner = await prisma.owner.findUnique({ where: { userId } });
  if (!owner) {
    const ownerKey = await issueSemaIdentifier('OWNER', { userId, source: 'local-bootstrap' });
    owner = await prisma.owner.create({
      data: { ownerId: ownerKey.id, userId, name: config.localFirst.localOwnerName },
    });
  }

  let workspace = await prisma.workspace.findFirst({
    where: { ownerId: owner.id }, orderBy: { createdAt: 'asc' },
  });
  if (!workspace) {
    const workspaceKey = await issueSemaIdentifier('WORKSPACE', { ownerId: owner.id, source: 'local-bootstrap' });
    workspace = await prisma.workspace.create({
      data: { workspaceId: workspaceKey.id, ownerId: owner.id, name: config.localFirst.localWorkspaceName },
    });
  }

  const membership = await prisma.workspaceMembership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    update: { role: WorkspaceRole.OWNER, status: WorkspaceMemberStatus.ACTIVE },
    create: { workspaceId: workspace.id, userId, role: WorkspaceRole.OWNER },
  });

  let profile = await prisma.semaProfile.findFirst({
    where: { userId, status: 'ACTIVE' }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!profile) {
    const profileKey = await issueSemaIdentifier('PROFILE', { userId, source: 'local-bootstrap' });
    profile = await prisma.semaProfile.create({
      data: {
        profileId: profileKey.id,
        userId,
        displayName: user.firstName || user.email,
        isDefault: true,
        activeWorkspaceId: workspace.id,
      },
    });
  } else if (!profile.activeWorkspaceId) {
    profile = await prisma.semaProfile.update({ where: { id: profile.id }, data: { activeWorkspaceId: workspace.id } });
  }

  return { userId, profileId: profile.id, ownerId: owner.id, workspaceId: workspace.id, workspaceMembershipId: membership.id, role: membership.role };
}

/** Resolve an explicit context. Call this in all future commands and workers. */
export async function resolveSemaAccessContext(input: { userId: string; profileId?: string; workspaceId?: string }): Promise<SemaAccessContext> {
  const fallback = await ensureLocalSemaAccessContext(input.userId);
  const profileId = input.profileId || fallback.profileId;
  const profile = await prisma.semaProfile.findFirstOrThrow({ where: { id: profileId, userId: input.userId, status: 'ACTIVE' } });
  const workspaceId = input.workspaceId || profile.activeWorkspaceId || fallback.workspaceId;
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { workspaceId, userId: input.userId, status: 'ACTIVE' }, include: { workspace: true },
  });
  return { userId: input.userId, profileId: profile.id, ownerId: membership.workspace.ownerId, workspaceId, workspaceMembershipId: membership.id, role: membership.role };
}

export function mayModifyWorkspace(role: WorkspaceRole) {
  return role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMINISTRATOR || role === WorkspaceRole.MEMBER;
}

export function mayAdministerWorkspace(role: WorkspaceRole) {
  return role === WorkspaceRole.OWNER || role === WorkspaceRole.ADMINISTRATOR;
}
