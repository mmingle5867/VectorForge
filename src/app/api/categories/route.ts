import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { createCategory, deleteCategoryBranch, listCategoryTree, moveCategory } from '@/services/categories';
import { ensureDefaultSemaProfile } from '@/services/profile-storage';

export async function GET() {
  try {
    const user = await requireAuth();
    const profile = await ensureDefaultSemaProfile(user.id);
    const categories = await listCategoryTree({
      profileId: profile.id,
      scopeType: 'PROFILE',
      scopeId: profile.profileId,
    });
    return NextResponse.json({ success: true, categories });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load categories' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const profile = await ensureDefaultSemaProfile(user.id);
    const body = await req.json();
    const category = await createCategory({
      profileId: profile.id,
      scopeType: 'PROFILE',
      scopeId: profile.profileId,
      parentId: typeof body.parentId === 'string' && body.parentId ? body.parentId : null,
      name: typeof body.name === 'string' ? body.name : '',
    });
    return NextResponse.json({ success: true, category });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to create category' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth();
    const profile = await ensureDefaultSemaProfile(user.id);
    const body = await req.json();
    const categoryId = typeof body.categoryId === 'string' ? body.categoryId : '';
    if (!categoryId) {
      return NextResponse.json({ success: false, error: 'Category is required' }, { status: 400 });
    }
    const result = await deleteCategoryBranch({ categoryId, profileId: profile.id });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to delete Category' },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth(); const profile = await ensureDefaultSemaProfile(user.id); const body = await req.json();
    if (typeof body.categoryId !== 'string') return NextResponse.json({ success: false, error: 'Category is required' }, { status: 400 });
    const newParentId = typeof body.newParentId === 'string' && body.newParentId ? body.newParentId : null;
    return NextResponse.json({ success: true, category: await moveCategory({ categoryId: body.categoryId, profileId: profile.id, newParentId }) });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to move category' }, { status: 400 }); }
}
