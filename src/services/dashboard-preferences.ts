import type { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';

type DashboardViewModeValue = 'LARGE_IMAGE' | 'THUMBNAIL' | 'LIST' | 'DETAILS';
type CategoryMatchModeValue = 'ANY' | 'ALL';

async function resolvePreferenceContext(input: {
  profileId: string;
  workspaceId?: string | null;
}) {
  const profile = await prisma.semaProfile.findUnique({ where: { id: input.profileId } });
  if (!profile || profile.status !== 'ACTIVE') {
    throw new Error('Active SEMA profile not found');
  }

  if (!input.workspaceId) {
    return { profile, workspace: null, contextKey: `profile:${profile.profileId}` };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    include: { owner: true },
  });
  if (!workspace || workspace.owner.userId !== profile.userId) {
    throw new Error('Workspace is not available to this SEMA profile');
  }

  return {
    profile,
    workspace,
    contextKey: `workspace:${workspace.workspaceId}`,
  };
}

export async function getDashboardPreference(input: {
  profileId: string;
  workspaceId?: string | null;
}) {
  const context = await resolvePreferenceContext(input);
  return prisma.dashboardPreference.findUnique({
    where: {
      profileId_contextKey: {
        profileId: context.profile.id,
        contextKey: context.contextKey,
      },
    },
  });
}

export async function saveDashboardPreference(input: {
  profileId: string;
  workspaceId?: string | null;
  viewMode?: DashboardViewModeValue;
  expandedCategoryIds?: string[];
  selectedCategoryIds?: string[];
  includeDescendants?: boolean;
  categoryMatchMode?: CategoryMatchModeValue;
  filters?: Prisma.InputJsonValue;
  sorting?: Prisma.InputJsonValue;
}) {
  const context = await resolvePreferenceContext(input);
  const referencedCategoryIds = [
    ...(input.expandedCategoryIds ?? []),
    ...(input.selectedCategoryIds ?? []),
  ];

  if (referencedCategoryIds.length > 0) {
    const uniqueIds = [...new Set(referencedCategoryIds)];
    const categoryCount = await prisma.category.count({
      where: {
        id: { in: uniqueIds },
        profileId: context.profile.id,
        status: 'ACTIVE',
        ...(context.workspace ? { workspaceId: context.workspace.id } : {}),
      },
    });
    if (categoryCount !== uniqueIds.length) {
      throw new Error('Dashboard preferences contain unavailable Categories');
    }
  }

  const update: Prisma.DashboardPreferenceUpdateInput = {};
  if (input.viewMode !== undefined) update.viewMode = input.viewMode;
  if (input.expandedCategoryIds !== undefined) {
    update.expandedCategoryIds = input.expandedCategoryIds;
  }
  if (input.selectedCategoryIds !== undefined) {
    update.selectedCategoryIds = input.selectedCategoryIds;
  }
  if (input.includeDescendants !== undefined) {
    update.includeDescendants = input.includeDescendants;
  }
  if (input.categoryMatchMode !== undefined) {
    update.categoryMatchMode = input.categoryMatchMode;
  }
  if (input.filters !== undefined) update.filters = input.filters;
  if (input.sorting !== undefined) update.sorting = input.sorting;

  return prisma.dashboardPreference.upsert({
    where: {
      profileId_contextKey: {
        profileId: context.profile.id,
        contextKey: context.contextKey,
      },
    },
    update,
    create: {
      profileId: context.profile.id,
      workspaceId: context.workspace?.id ?? null,
      contextKey: context.contextKey,
      viewMode: input.viewMode ?? 'THUMBNAIL',
      expandedCategoryIds: input.expandedCategoryIds ?? [],
      selectedCategoryIds: input.selectedCategoryIds ?? [],
      includeDescendants: input.includeDescendants ?? true,
      categoryMatchMode: input.categoryMatchMode ?? 'ANY',
      filters: input.filters ?? {},
      sorting: input.sorting ?? [],
    },
  });
}
