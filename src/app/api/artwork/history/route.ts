import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const user = await requireAuth();
    const commands = await prisma.semaCoreCommand.findMany({ where: { actorId: user.id, commandType: { startsWith: 'vectorforge.artwork.' } }, orderBy: { createdAt: 'desc' }, take: 250, select: { id: true, commandType: true, status: true, subjectIds: true, payload: true, createdAt: true } });
    return NextResponse.json({ success: true, commands });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load artwork history' }, { status: 500 }); }
}
