import path from 'node:path';

export function normalizeRelativeAssetPath(value: string): string {
  const input = value.trim();
  if (!input || input.includes('\0')) {
    throw new Error('Asset location requires a valid relative path');
  }
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input)) {
    throw new Error('Asset locations must be relative to a registered Storage Location');
  }

  const normalized = input.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Asset location cannot contain empty, current, or parent path segments');
  }
  return segments.join('/');
}

export function normalizeSha256(value: string): string {
  const sha256 = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Asset version requires a valid SHA-256 hash');
  }
  return sha256;
}

export function normalizeByteLength(value: number | bigint): bigint {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Asset byte length must be a non-negative safe integer');
  }
  const byteLength = typeof value === 'bigint' ? value : BigInt(value);
  if (byteLength < BigInt(0)) {
    throw new Error('Asset byte length cannot be negative');
  }
  return byteLength;
}
