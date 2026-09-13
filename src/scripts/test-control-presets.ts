import assert from 'node:assert/strict';

import {
  normalizeControlPresets,
  normalizeRasterEditorPreparation,
  normalizeTuneControlSettings,
} from '@/lib/control-presets';

const preparation = normalizeRasterEditorPreparation({ blur: 3.5, upscaleFactor: 4 });
assert.deepEqual(preparation, { blur: 3.5, upscaleFactor: 4 });
assert.deepEqual(normalizeRasterEditorPreparation({ blur: -20, upscaleFactor: 3 }), { blur: 0, upscaleFactor: 1 });

const settings = normalizeTuneControlSettings({ colorMode: 'color', blur: 2.2, pathPrecision: 99 });
assert.equal(settings.colorMode, 'color');
assert.equal(settings.blur, 2.2);
assert.equal(settings.pathPrecision, 8);

const presets = normalizeControlPresets([{
  id: 'CONTROL-PRESET-1',
  name: 'Line Art',
  description: 'Clean black and white artwork',
  settings,
  rasterPreparation: preparation,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
}]);
assert.equal(presets.length, 1);
assert.equal(presets[0].name, 'Line Art');
assert.equal(presets[0].rasterPreparation.upscaleFactor, 4);

console.log('Control preset tests passed.');
