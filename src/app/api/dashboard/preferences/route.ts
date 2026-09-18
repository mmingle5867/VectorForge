import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { ensureOwnerAndWorkspace } from '@/services/sema-identity';
import { ensureDefaultSemaProfile } from '@/services/profile-storage';
import {
  getDashboardPreference,
  saveDashboardPreference,
} from '@/services/dashboard-preferences';

const VIEW_MODES = ['LARGE_IMAGE', 'THUMBNAIL', 'LIST', 'DETAILS'] as const;

async function context(userId: string) {
  const profile = await ensureDefaultSemaProfile(userId);
  const { workspace } = await ensureOwnerAndWorkspace(userId);
  return { profile, workspace };
}

export async function GET() {
  try {
    const user = await requireAuth();
    const { profile, workspace } = await context(user.id);
    const preference = await getDashboardPreference({
      profileId: profile.id,
      workspaceId: workspace.id,
    });
    return NextResponse.json({ success: true, preference });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to load preferences' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    if (body.viewMode && !VIEW_MODES.includes(body.viewMode)) {
      return NextResponse.json({ success: false, error: 'Invalid view mode' }, { status: 400 });
    }
    const { profile, workspace } = await context(user.id);
    const preference = await saveDashboardPreference({
      profileId: profile.id,
      workspaceId: workspace.id,
      viewMode: body.viewMode,
      expandedCategoryIds: Array.isArray(body.expandedCategoryIds) ? body.expandedCategoryIds.filter((id): id is string => typeof id === 'string') : undefined,
      selectedCategoryIds: Array.isArray(body.selectedCategoryIds) ? body.selectedCategoryIds.filter((id): id is string => typeof id === 'string') : undefined,
      includeDescendants: typeof body.includeDescendants === 'boolean' ? body.includeDescendants : undefined,
      filters: body.filters,
      sorting: body.sorting,
    });
    return NextResponse.json({ success: true, preference });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unable to save preferences' },
      { status: 500 }
    );
  }
}
