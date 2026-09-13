import assert from 'node:assert/strict';
import path from 'node:path';

import { getDirectArtworkLayout } from '../services/artwork-direct-ingest';

const layout = getDirectArtworkLayout(path.join('storage', 'artwork'), 'flower-0002', 'flower.png');
assert.ok(layout.original.endsWith(path.join('flower-0002', 'original', 'flower.png')));
assert.ok(layout.working.endsWith(path.join('flower-0002', 'vectorforge', 'working', 'flower.png')));
assert.ok(layout.manifest.endsWith(path.join('flower-0002', 'vectorforge', 'manifest', 'manifest.json')));
assert.notEqual(layout.original, layout.working, 'Original and working copy must never use the same path');

console.log('Direct artwork ingest layout tests passed.');
