/**
 * Compatibility facade for shared SEMA Core identity. It deliberately
 * contains no VectorForge identity algorithm.
 */
export {
  SEMA_BASE56_ALPHABET,
  decodeBase56,
  encodeBase56,
  formatKeyId as formatSemaId,
  formatKeyId as formatSemaKeyId,
  normalizeTypeCode,
  parseInstallationId as parseSemaInstallationId,
  parseKeyId as parseSemaId,
  parseKeyId as parseSemaKeyId,
} from '@selo/sema-core';
export type { SemaKeyIdParts } from '@selo/sema-core';

import { parseKeyId } from '@selo/sema-core';
export function semaLocalToken(semaId: string) { return parseKeyId(semaId).localId; }
