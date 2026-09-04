import assert from 'node:assert/strict';

import {
  normalizeByteLength,
  normalizeRelativeAssetPath,
  normalizeSha256,
} from '../lib/asset-location-rules';
import {
  assertNoCategoryCycle,
  normalizeCategoryName,
  parentKeyFor,
  ROOT_CATEGORY_PARENT_KEY,
  validateCategoryName,
} from '../lib/category-rules';

assert.equal(normalizeCategoryName('  Holiday   Artwork  '), 'holiday artwork');
assert.equal(validateCategoryName('  Holiday   Artwork  '), 'Holiday Artwork');
assert.equal(parentKeyFor(null), ROOT_CATEGORY_PARENT_KEY);
assert.equal(parentKeyFor('CATEGORY-1'), 'CATEGORY-1');

const records = [
  { id: 'root', parentId: null },
  { id: 'child', parentId: 'root' },
  { id: 'grandchild', parentId: 'child' },
];

assert.doesNotThrow(() => assertNoCategoryCycle('child', null, records));
assert.doesNotThrow(() => assertNoCategoryCycle('grandchild', 'root', records));
assert.throws(
  () => assertNoCategoryCycle('root', 'grandchild', records),
  /cannot be moved beneath itself/
);
assert.throws(() => validateCategoryName('   '), /required/);
assert.throws(() => validateCategoryName('bad\u0000name'), /control characters/);

assert.equal(normalizeRelativeAssetPath('items\\artwork\\image.svg'), 'items/artwork/image.svg');
assert.throws(() => normalizeRelativeAssetPath('C:\\artwork\\image.svg'), /must be relative/);
assert.throws(() => normalizeRelativeAssetPath('../image.svg'), /parent path segments/);
assert.equal(normalizeSha256('A'.repeat(64)), 'a'.repeat(64));
assert.throws(() => normalizeSha256('not-a-hash'), /valid SHA-256/);
assert.equal(normalizeByteLength(42), BigInt(42));
assert.throws(() => normalizeByteLength(-1), /non-negative/);

console.log('Foundation rule tests passed.');
