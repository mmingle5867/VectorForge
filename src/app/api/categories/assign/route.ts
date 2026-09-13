import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { assignItemToCategory, removeItemFromCategory } from '@/services/categories';
import { ensureDefaultSemaProfile } from '@/services/profile-storage';
import { logger } from '@/lib/logger';

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth();
    const profile = await ensureDefaultSemaProfile(user.id);
    const body = await req.json();
    const itemIds = Array.isArray(body.itemIds)
      ? body.itemIds.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const categoryIds = Array.isArray(body.categoryIds)
      ? body.categoryIds.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const items = await prisma.item.findMany({
      where: { id: { in: itemIds }, owner: { userId: user.id } },
      select: { id: true, categoryMemberships: { select: { categoryId: true } } },
    });
    if (items.length !== itemIds.length) throw new Error('One or more selected files are unavailable');

    for (const item of items) {
      const existing = new Set(item.categoryMemberships.map((membership) => membership.categoryId));
      for (const categoryId of categoryIds) {
        if (!existing.has(categoryId)) {
          await assignItemToCategory({ itemId: item.id, categoryId, assignedByProfileId: profile.id });
        }
      }
      for (const categoryId of existing) {
        if (!categoryIds.includes(categoryId)) {
          await removeItemFromCategory({ itemId: item.id, categoryId, profileId: profile.id });
        }
      }
    }
    return NextResponse.json({ success: true, updated: items.length });
  } catch (error) {
    logger.error('Category assignment failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to assign categories' }, { status: 400 });
  }
}

/** Adds a category without replacing an artwork's existing category set. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const profile = await ensureDefaultSemaProfile(user.id);
    const body = await req.json();
    const itemIds = Array.isArray(body.itemIds)
      ? body.itemIds.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const categoryId = typeof body.categoryId === 'string' ? body.categoryId : '';
    if (!categoryId || !itemIds.length) throw new Error('Select artwork and a category');

    const items = await prisma.item.findMany({
      where: { id: { in: itemIds }, owner: { userId: user.id } },
      select: { id: true, categoryMemberships: { select: { categoryId: true } } },
    });
    if (items.length !== itemIds.length) throw new Error('One or more selected files are unavailable');
    for (const item of items) {
      if (!item.categoryMemberships.some((membership) => membership.categoryId === categoryId)) {
        await assignItemToCategory({ itemId: item.id, categoryId, assignedByProfileId: profile.id });
      }
    }
    return NextResponse.json({ success: true, updated: items.length });
  } catch (error) {
    logger.error('Category drop assignment failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to assign category' }, { status: 400 });
  }
}
