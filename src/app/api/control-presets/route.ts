import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import {
  DEFAULT_RASTER_EDITOR_PREPARATION,
  normalizeControlPresets,
  normalizeRasterEditorPreparation,
  normalizeTuneControlSettings,
} from '@/lib/control-presets';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { issueSemaIdentifier } from '@/services/sema-core-identity';

function settingsObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export async function GET() {
  try {
    const user = await requireAuth();
    const values = settingsObject(user.settings?.defaultSubstitutions);
    return NextResponse.json({
      success: true,
      lastSettings: values.lastTuneControlSettings
        ? normalizeTuneControlSettings(values.lastTuneControlSettings)
        : null,
      rasterPreparation: normalizeRasterEditorPreparation(
        values.rasterEditorPreparation ?? DEFAULT_RASTER_EDITOR_PREPARATION
      ),
      presets: normalizeControlPresets(values.controlPresets),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load control presets' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const action = typeof body.action === 'string' ? body.action : '';
    const current = settingsObject(user.settings?.defaultSubstitutions);
    const presets = normalizeControlPresets(current.controlPresets);

    if (action === 'persist-current') {
      current.lastTuneControlSettings = normalizeTuneControlSettings(body.settings);
      current.rasterEditorPreparation = normalizeRasterEditorPreparation(body.rasterPreparation);
    } else if (action === 'save-preset') {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
      if (!name) throw new Error('Preset name is required');
      const now = new Date().toISOString();
      const requestedId = typeof body.id === 'string' ? body.id : '';
      const existing = presets.find((preset) => preset.id === requestedId);
      const presetIdentifier = existing ? null : await issueSemaIdentifier('PST', {
        purpose: 'control-setting-preset',
        name,
      });
      const preset = {
        id: existing?.id ?? presetIdentifier!.id,
        name,
        description,
        settings: normalizeTuneControlSettings(
          body.settings ?? existing?.settings ?? current.lastTuneControlSettings
        ),
        rasterPreparation: normalizeRasterEditorPreparation(
          body.rasterPreparation ?? existing?.rasterPreparation ?? current.rasterEditorPreparation
        ),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      current.controlPresets = existing
        ? presets.map((entry) => entry.id === preset.id ? preset : entry)
        : [...presets, preset];
    } else if (action === 'delete-preset') {
      current.controlPresets = presets.filter((preset) => preset.id !== body.id);
    } else if (action === 'use-preset') {
      const preset = presets.find((entry) => entry.id === body.id);
      if (!preset) throw new Error('Preset not found');
      current.lastTuneControlSettings = preset.settings;
      current.rasterEditorPreparation = preset.rasterPreparation;
    } else {
      throw new Error('Unsupported control preset action');
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: { defaultSubstitutions: current as Prisma.InputJsonValue },
      create: { userId: user.id, defaultSubstitutions: current as Prisma.InputJsonValue },
    });
    const saved = settingsObject(settings.defaultSubstitutions);
    return NextResponse.json({
      success: true,
      lastSettings: saved.lastTuneControlSettings ? normalizeTuneControlSettings(saved.lastTuneControlSettings) : null,
      rasterPreparation: normalizeRasterEditorPreparation(saved.rasterEditorPreparation),
      presets: normalizeControlPresets(saved.controlPresets),
    });
  } catch (error) {
    logger.error('Control preset update failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to save control preset' }, { status: 400 });
  }
}
