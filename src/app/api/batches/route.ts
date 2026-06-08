/**
 * VectorForge - Batches API Route
 * List all batches for the current user.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const user = await requireAuth();

    const batches = await prisma.batch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        totalItems: true,
        completedItems: true,
        failedItems: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return NextResponse.json({ success: true, batches });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}