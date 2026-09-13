/**
 * Canonical SEMA KeyID encoding.
 *
 * A KeyID is a variable-length, hyphen-delimited allocation path. Type codes,
 * timestamps, checksums, and storage information are deliberately excluded.
 */
export const SEMA_BASE56_ALPHABET =
  '234567890ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';

const ZERO = BigInt(0);
const ONE = BigInt(1);
const BASE = BigInt(SEMA_BASE56_ALPHABET.length);

export interface SemaKeyIdParts {
  installationId: string;
  localId: string;
  localValue: bigint;
}

function assertBase56Segment(value: string, label = 'SEMA KeyID segment') {
  if (!value) throw new Error(`${label} cannot be empty`);
  for (const character of value) {
    if (!SEMA_BASE56_ALPHABET.includes(character)) {
      throw new Error(`Invalid SEMA Base56 character: ${character}`);
    }
  }
  if (value.length > 1 && value.startsWith(SEMA_BASE56_ALPHABET[0])) {
    throw new Error(`${label} is not in shortest canonical Base56 form`);
  }
}

export function encodeBase56(value: bigint) {
  if (value < ZERO) throw new Error('SEMA Base56 values cannot be negative');
  if (value === ZERO) return SEMA_BASE56_ALPHABET[0];

  let remaining = value;
  let encoded = '';
  while (remaining > ZERO) {
    encoded = SEMA_BASE56_ALPHABET[Number(remaining % BASE)] + encoded;
    remaining /= BASE;
  }
  return encoded;
}

export function decodeBase56(value: string) {
  assertBase56Segment(value);
  let decoded = ZERO;
  for (const character of value) {
    decoded = (decoded * BASE) + BigInt(SEMA_BASE56_ALPHABET.indexOf(character));
  }
  return decoded;
}

/** Validate a permanent installation namespace, including a top-level `3`. */
export function parseSemaInstallationId(value: string) {
  const candidate = value.trim();
  const segments = candidate.split('-');
  if (!candidate || segments.some((segment) => !segment)) {
    throw new Error('SEMA InstallationID must contain non-empty hyphen-delimited segments');
  }
  for (const segment of segments) assertBase56Segment(segment, 'SEMA InstallationID segment');
  return candidate;
}

export function formatSemaKeyId(input: { installationId: string; localValue: bigint }) {
  if (input.localValue < ONE) throw new Error('SEMA LocalID zero is reserved');
  const installationId = parseSemaInstallationId(input.installationId);
  return `${installationId}-${encodeBase56(input.localValue)}`;
}

export function parseSemaKeyId(value: string): SemaKeyIdParts {
  const candidate = value.trim();
  const segments = candidate.split('-');
  if (segments.length < 2 || segments.some((segment) => !segment)) {
    throw new Error('SEMA KeyID must contain an InstallationID and a LocalID');
  }
  const localId = segments.at(-1)!;
  const installationId = parseSemaInstallationId(segments.slice(0, -1).join('-'));
  const localValue = decodeBase56(localId);
  if (localValue === ZERO) throw new Error('SEMA LocalID zero is reserved');
  return { installationId, localId, localValue };
}

/** Type codes are optional human-readable classification metadata only. */
export function normalizeTypeCode(value: string) {
  const typeCode = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,31}$/.test(typeCode)) {
    throw new Error('TypeCode must be 1-32 readable uppercase letters, digits, underscores, or hyphens');
  }
  return typeCode;
}

// Compatibility aliases retained while VectorForge call sites move from the
// rejected fixed-width prototype. They implement the final canonical model.
export const formatSemaId = formatSemaKeyId;
export const parseSemaId = parseSemaKeyId;
export function semaLocalToken(semaId: string) {
  return parseSemaKeyId(semaId).localId;
}
