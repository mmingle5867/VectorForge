import assert from 'node:assert/strict';

import { GRAPHICS_CAPABILITIES } from '../capabilities/graphics/registry';

const keys = Object.values(GRAPHICS_CAPABILITIES);

assert.equal(new Set(keys).size, keys.length, 'Each graphics intent must have one unique capability key');
assert.deepEqual(keys, [
  'sema.graphics.raster.blur',
  'sema.graphics.raster.upscale',
  'sema.graphics.raster.transform',
  'sema.graphics.raster.composite',
  'sema.graphics.vector.trace',
  'sema.graphics.vector.optimize',
]);

console.log('Graphics capability declaration tests passed.');
