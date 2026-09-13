import assert from 'node:assert/strict';

import {
  decodeBase56,
  encodeBase56,
  formatSemaKeyId,
  parseSemaInstallationId,
  parseSemaKeyId,
  SEMA_BASE56_ALPHABET,
} from '../lib/sema-id';

assert.equal(SEMA_BASE56_ALPHABET, '234567890ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz');
assert.equal(encodeBase56(BigInt(0)), '2');
assert.equal(encodeBase56(BigInt(1)), '3');
assert.equal(encodeBase56(BigInt(56)), '32');
assert.equal(decodeBase56('32'), BigInt(56));

assert.equal(parseSemaInstallationId('3'), '3');
assert.equal(parseSemaInstallationId('b-34-3'), 'b-34-3');
assert.equal(formatSemaKeyId({ installationId: '3', localValue: BigInt(1) }), '3-3');
assert.equal(formatSemaKeyId({ installationId: 'b-34-3', localValue: BigInt(1) }), 'b-34-3-3');

const parsed = parseSemaKeyId('b-34-3-3');
assert.equal(parsed.installationId, 'b-34-3');
assert.equal(parsed.localValue, BigInt(1));
assert.throws(() => parseSemaKeyId('b-21-3'), /Invalid SEMA Base56 character/);
assert.throws(() => parseSemaKeyId('3-2'), /zero is reserved/);
assert.throws(() => parseSemaKeyId('3-23-3'), /shortest canonical/);

console.log('SEMA KeyID tests passed.');
