import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  assertNoCategoryCycle,
  normalizeCategoryName,
  parentKeyFor,
  validateCategoryName,
} from '@/lib/category-rules';
import prisma from '@/lib/prisma';

type CategoryScopeTypeValue = 'PROFILE' | 'WORKSPACE' | 'ORGANIZATION' | 'PROJECT';

function makeCategoryId(): string {
  return `CATEGORY-${randomUUID().toUpperCase()}`;
}

async function validateCategoryScope(
  client: Prisma.TransactionClient,
  input: {
    profileId: string;
    workspaceId?: string | null;
    scopeType: CategoryScopeTypeValue;
    scopeId: string;
  }
) {
  const profile = await client.semaProfile.findUnique({ where: { id: input.profileId } });
  if (!profile || profile.status !== 'ACTIVE') {
    throw new Error('Active SEMA profile not found for Category scope');
  }

  if (input.scopeType === 'PROFILE') {
    if (input.scopeId !== profile.profileId || input.workspaceId) {
      throw new Error('Profile Categories must use the owning profile identity and no workspace');
    }
    return profile;
  }

  if (input.scopeType === 'WORKSPACE') {
    if (!input.workspaceId) {
      throw new Error('Workspace Categories require a workspace');
    }
    const workspace = await client.workspace.findUnique({
      where: { id: input.workspaceId },
      include: { owner: true },
    });
    if (
      !workspace ||
      workspace.workspaceId !== input.scopeId ||
      workspace.owner.userId !== profile.userId
    ) {
      throw new Error('Workspace Category scope is not available to this profile');
    }
    return profile;
  }

  throw new Error(`${input.scopeType} Category scopes are reserved but not enabled yet`);
}

export async function createCategory(input: {
  profileId: string;
  workspaceId?: string | null;
  scopeType: CategoryScopeTypeValue;
  scopeId: string;
  parentId?: string | null;
  name: string;
  sortOrder?: number;
  metadata?: Prisma.InputJsonValue;
}) {
  const name = validateCategoryName(input.name);
  const normalizedName = normalizeCategoryName(name);

  return prisma.$transaction(async (tx) => {
    await validateCategoryScope(tx, input);

    const parent = input.parentId
      ? await tx.category.findUnique({ where: { id: input.parentId } })
      : null;

    if (input.parentId && !parent) {
      throw new Error('Parent Category not found');
    }
    if (
      parent &&
      (parent.profileId !== input.profileId ||
        parent.workspaceId !== (input.workspaceId ?? null) ||
        parent.scopeType !== input.scopeType ||
        parent.scopeId !== input.scopeId ||
        parent.status !== 'ACTIVE')
    ) {
      throw new Error('Parent Category must be active and in the same scope');
    }

    return tx.category.create({
      data: {
        categoryId: makeCategoryId(),
        profileId: input.profileId,
        workspaceId: input.workspaceId ?? null,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        parentId: parent?.id ?? null,
        parentKey: parentKeyFor(parent?.categoryId),
        name,
        normalizedName,
        sortOrder: input.sortOrder ?? 0,
        metadata: input.metadata ?? {},
      },
    });
  });
}

export async function renameCategory(input: {
  categoryId: string;
  profileId: string;
  newName: string;
}) {
  const name = validateCategoryName(input.newName);
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, profileId: input.profileId, status: 'ACTIVE' },
  });
  if (!category) {
    throw new Error('Active Category not found for this profile');
  }
  return prisma.category.update({
    where: { id: category.id },
    data: { name, normalizedName: normalizeCategoryName(name) },
  });
}

export async function moveCategory(input: {
  categoryId: string;
  profileId: string;
  newParentId: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "categories"
      WHERE id = ${input.categoryId}
      FOR UPDATE
    `;

    const category = await tx.category.findFirst({
      where: { id: input.categoryId, profileId: input.profileId, status: 'ACTIVE' },
    });
    if (!category) {
      throw new Error('Active Category not found for this profile');
    }

    const scopedCategories = await tx.category.findMany({
      where: {
        profileId: category.profileId,
        scopeType: category.scopeType,
        scopeId: category.scopeId,
      },
      select: { id: true, parentId: true },
    });
    assertNoCategoryCycle(category.id, input.newParentId, scopedCategories);

    const parent = input.newParentId
      ? await tx.category.findUnique({ where: { id: input.newParentId } })
      : null;
    if (input.newParentId && !parent) {
      throw new Error('New parent Category not found');
    }
    if (
      parent &&
      (parent.profileId !== category.profileId ||
        parent.workspaceId !== category.workspaceId ||
        parent.scopeType !== category.scopeType ||
        parent.scopeId !== category.scopeId ||
        parent.status !== 'ACTIVE')
    ) {
      throw new Error('New parent Category must be active and in the same scope');
    }

    return tx.category.update({
      where: { id: category.id },
      data: {
        parentId: parent?.id ?? null,
        parentKey: parentKeyFor(parent?.categoryId),
      },
    });
  });
}

export async function assignItemToCategory(input: {
  itemId: string;
  categoryId: string;
  assignedByProfileId: string;
  isPrimary?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const [item, category, assigningProfile] = await Promise.all([
      tx.item.findUnique({ where: { id: input.itemId }, include: { owner: true } }),
      tx.category.findUnique({ where: { id: input.categoryId } }),
      tx.semaProfile.findUnique({ where: { id: input.assignedByProfileId } }),
    ]);
    if (
      !item ||
      !category ||
      category.status !== 'ACTIVE' ||
      !assigningProfile ||
      assigningProfile.status !== 'ACTIVE'
    ) {
      throw new Error('Item, active Category, or assigning profile not found');
    }
    if (
      category.profileId !== assigningProfile.id ||
      item.owner.userId !== assigningProfile.userId
    ) {
      throw new Error('Assigning profile is not authorized for this Item and Category');
    }
    if (category.workspaceId && category.workspaceId !== item.workspaceId) {
      throw new Error('Item and Category belong to different workspaces');
    }

    if (input.isPrimary) {
      const peerCategories = await tx.category.findMany({
        where: {
          profileId: category.profileId,
          scopeType: category.scopeType,
          scopeId: category.scopeId,
        },
        select: { id: true },
      });
      await tx.itemCategory.updateMany({
        where: {
          itemId: item.id,
          categoryId: { in: peerCategories.map((peer) => peer.id) },
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    return tx.itemCategory.upsert({
      where: { itemId_categoryId: { itemId: item.id, categoryId: category.id } },
      update: {
        assignedByProfileId: input.assignedByProfileId,
        isPrimary: input.isPrimary ?? undefined,
      },
      create: {
        itemId: item.id,
        categoryId: category.id,
        assignedByProfileId: input.assignedByProfileId,
        isPrimary: input.isPrimary ?? false,
      },
    });
  });
}

export async function removeItemFromCategory(input: {
  itemId: string;
  categoryId: string;
  profileId: string;
}) {
  const membership = await prisma.itemCategory.findUnique({
    where: {
      itemId_categoryId: { itemId: input.itemId, categoryId: input.categoryId },
    },
    include: { category: true },
  });
  if (!membership || membership.category.profileId !== input.profileId) {
    throw new Error('Category membership not found for this profile');
  }
  return prisma.itemCategory.delete({
    where: {
      itemId_categoryId: { itemId: input.itemId, categoryId: input.categoryId },
    },
  });
}

export async function assignRelationshipToCategory(input: {
  relationshipId: string;
  categoryId: string;
  assignedByProfileId: string;
  isPrimary?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const [relationship, category, assigningProfile] = await Promise.all([
      tx.relationship.findUnique({
        where: { id: input.relationshipId },
        include: { owner: true },
      }),
      tx.category.findUnique({ where: { id: input.categoryId } }),
      tx.semaProfile.findUnique({ where: { id: input.assignedByProfileId } }),
    ]);
    if (
      !relationship ||
      !category ||
      category.status !== 'ACTIVE' ||
      !assigningProfile ||
      assigningProfile.status !== 'ACTIVE'
    ) {
      throw new Error('Relationship, active Category, or assigning profile not found');
    }
    if (
      category.profileId !== assigningProfile.id ||
      relationship.owner.userId !== assigningProfile.userId ||
      (category.workspaceId && category.workspaceId !== relationship.workspaceId)
    ) {
      throw new Error('Assigning profile is not authorized for this Relationship and Category');
    }

    if (input.isPrimary) {
      const peerCategories = await tx.category.findMany({
        where: {
          profileId: category.profileId,
          scopeType: category.scopeType,
          scopeId: category.scopeId,
        },
        select: { id: true },
      });
      await tx.relationshipCategory.updateMany({
        where: {
          relationshipId: relationship.id,
          categoryId: { in: peerCategories.map((peer) => peer.id) },
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    return tx.relationshipCategory.upsert({
      where: {
        relationshipId_categoryId: {
          relationshipId: relationship.id,
          categoryId: category.id,
        },
      },
      update: {
        assignedByProfileId: input.assignedByProfileId,
        isPrimary: input.isPrimary ?? undefined,
      },
      create: {
        relationshipId: relationship.id,
        categoryId: category.id,
        assignedByProfileId: input.assignedByProfileId,
        isPrimary: input.isPrimary ?? false,
      },
    });
  });
}

export async function removeRelationshipFromCategory(input: {
  relationshipId: string;
  categoryId: string;
  profileId: string;
}) {
  const membership = await prisma.relationshipCategory.findUnique({
    where: {
      relationshipId_categoryId: {
        relationshipId: input.relationshipId,
        categoryId: input.categoryId,
      },
    },
    include: { category: true },
  });
  if (!membership || membership.category.profileId !== input.profileId) {
    throw new Error('Relationship Category membership not found for this profile');
  }
  return prisma.relationshipCategory.delete({
    where: {
      relationshipId_categoryId: {
        relationshipId: input.relationshipId,
        categoryId: input.categoryId,
      },
    },
  });
}

export async function listCategoryTree(input: {
  profileId: string;
  scopeType: CategoryScopeTypeValue;
  scopeId: string;
}) {
  return prisma.category.findMany({
    where: {
      profileId: input.profileId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      status: 'ACTIVE',
    },
    orderBy: [{ parentKey: 'asc' }, { sortOrder: 'asc' }, { normalizedName: 'asc' }],
    include: {
      _count: {
        select: {
          children: true,
          itemMemberships: true,
          relationshipMemberships: true,
        },
      },
    },
  });
}

export async function retireCategory(input: { categoryId: string; profileId: string }) {
  const counts = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: {
      profileId: true,
      _count: {
        select: {
          children: true,
          itemMemberships: true,
          relationshipMemberships: true,
        },
      },
    },
  });
  if (!counts) {
    throw new Error('Category not found');
  }
  if (counts.profileId !== input.profileId) {
    throw new Error('Category is not owned by this profile');
  }
  if (
    counts._count.children > 0 ||
    counts._count.itemMemberships > 0 ||
    counts._count.relationshipMemberships > 0
  ) {
    throw new Error('Category must be empty before it can be retired');
  }
  return prisma.category.update({
    where: { id: input.categoryId },
    data: { status: 'RETIRED' },
  });
}
