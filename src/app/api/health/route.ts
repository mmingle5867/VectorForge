import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ service: 'vectorforge', status: 'ACTIVE', version: '0.71.2' });
}
