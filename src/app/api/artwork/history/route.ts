import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listCoreCommands } from '@/services/sema-core';

export async function GET() {
  try {
    const user = await requireAuth();
    const commands = await listCoreCommands({ actorId: user.id, commandTypePrefix: 'vectorforge.artwork.', limit: 250 });
    return NextResponse.json({ success: true, commands });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load artwork history' }, { status: 500 }); }
}
