import assert from 'node:assert/strict';
import path from 'node:path';

import {
  getVectorForgeStoragePaths,
  resolveProfileStorageBasePath,
} from '@/services/profile-storage';

const root = path.resolve('test-storage-root');
const base = resolveProfileStorageBasePath(root, 'PROFILE:test user');
const paths = getVectorForgeStoragePaths(base);

assert.equal(base, path.join(root, 'profiles', 'PROFILE-test-user'));
assert.equal(paths.processing, path.join(base, 'processing'));
assert.equal(paths.artwork, path.join(base, 'artwork'));
assert.equal(paths.bundles, path.join(base, 'bundles'));
assert.ok(!path.relative(base, paths.processing).startsWith('..'));
assert.ok(!path.relative(base, paths.artwork).startsWith('..'));

console.log('Ingest layout tests passed.');
