import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { isSvgMimeOrPath, normalizeImportedSvg } from '@/lib/svg-normalize';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ artworkId: string }> }) {
  try {
    const user = await requireAuth();
    const { artworkId } = await params;
    const artwork = await prisma.artwork.findUnique({ where: { id: artworkId }, include: { assets: true } });
    if (!artwork || artwork.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const requestedVariant = req.nextUrl.searchParams.get('variant');
    const requestedOriginal = requestedVariant === 'original';
    const requestedWorkingPng = requestedVariant === 'working-png';
    const sourceAsset = artwork.assets.find((candidate) => candidate.role === 'source-file');
    const asset = artwork.assets.find((candidate) => candidate.role === (requestedOriginal ? 'original-file' : requestedWorkingPng ? 'working-png' : 'source-file'));
    if (!asset?.filePath) return NextResponse.json({ error: 'No file available' }, { status: 404 });
    let filePath = asset.filePath;
    const versionKey = req.nextUrl.searchParams.get('versionKey');
    if (!requestedOriginal && versionKey && sourceAsset) {
      const version = await prisma.assetVersion.findFirst({
        where: { id: versionKey, assetId: sourceAsset.id, status: { not: 'RETIRED' } },
        include: { locations: { where: { isPrimary: true }, include: { storageLocation: { select: { basePath: true } } }, take: 1 } },
      });
      const location = version?.locations[0];
      if (!location) return NextResponse.json({ error: 'Selected version is unavailable' }, { status: 404 });
      filePath = path.resolve(location.storageLocation.basePath, location.relativePath);
    }
    const file = await readFile(filePath);
    if (isSvgMimeOrPath(asset.mimeType, filePath)) {
      return new Response(normalizeImportedSvg(file.toString('utf-8')).svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store, max-age=0' } });
    }
    if (requestedWorkingPng) {
      const preview = await sharp(file).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      return new Response(preview as unknown as BodyInit, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store, max-age=0' } });
    }
    // JPEG has no alpha channel. Explicitly use white rather than allowing
    // transparent WEBP pixels to turn black during dashboard rendering.
    const preview = await sharp(file).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
    return new Response(preview as unknown as BodyInit, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
