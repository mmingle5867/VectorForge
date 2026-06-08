/**
 * VectorForge - Server-only Utilities
 * These functions use Node.js APIs (fs, path) and must only be imported in server-side code.
 */

import { readdir } from 'fs/promises';
import { getIncrementalName } from './utils';

/**
 * Generate incremental folder name by checking existing folders in the base path.
 * Returns: baseName, baseName_001, baseName_002, etc.
 */
export async function getIncrementalFolderName(
  basePath: string,
  baseName: string
): Promise<string> {
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  let existingNames: string[] = [];
  try {
    existingNames = await readdir(basePath);
  } catch {
    // Directory doesn't exist yet, first name is fine
    return sanitized;
  }

  return getIncrementalName(sanitized, existingNames);
}