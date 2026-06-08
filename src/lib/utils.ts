import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a SKU string in format: DIGI-001-[basename]-[sequencenumber]
 */
export function generateSku(baseName: string, sequenceNumber: number): string {
  const sanitized = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const seq = String(sequenceNumber).padStart(3, '0');
  return `DIGI-001-${sanitized}-${seq}`;
}

/**
 * Generate incremental folder/file name.
 * Returns basename, basename_001, basename_002, etc.
 */
export function getIncrementalName(baseName: string, existingNames: string[]): string {
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (!existingNames.includes(sanitized)) {
    return sanitized;
  }

  let counter = 1;
  let candidate = `${sanitized}_${String(counter).padStart(3, '0')}`;
  while (existingNames.includes(candidate)) {
    counter++;
    candidate = `${sanitized}_${String(counter).padStart(3, '0')}`;
  }
  return candidate;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format date to readable string
 */
export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Sanitize filename for safe filesystem use
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]/, '')
    .substring(0, 200);
}

/**
 * Extract base name from filename (without extension)
 */
export function extractBaseName(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  return withoutExt
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Apply substitution variables to a template string
 */
export function applySubstitutions(
  template: string,
  substitutions: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(substitutions)) {
    const pattern = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(pattern, value);
  }
  return result;
}

