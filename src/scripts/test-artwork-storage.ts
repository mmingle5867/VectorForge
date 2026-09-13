import assert from 'node:assert/strict';
import path from 'node:path';

import { getManagedArtworkDirectory, isPathInside, remapPathWithinDirectory } from '@/lib/artwork-storage-paths';

const root = path.resolve('vectorforge-storage', 'profiles', 'PROFILE-TEST', 'artwork', 'sample');
const working = path.join(root, 'vectorforge', 'working', 'sample.png');
assert.equal(getManagedArtworkDirectory(working), root);
assert.equal(getManagedArtworkDirectory(path.resolve('uploads', 'batch', 'sample.png')), null);
assert.equal(isPathInside(root, working), true);
assert.equal(isPathInside(root, path.resolve('package.json')), false);

const destination = path.resolve('drive-storage', 'profiles', 'PROFILE-TEST', 'artwork', 'sample');
assert.equal(
  remapPathWithinDirectory(working, root, destination),
  path.join(destination, 'vectorforge', 'working', 'sample.png')
);

console.log('Artwork storage boundary tests passed.');
