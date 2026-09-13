export const DEFAULT_STATUS_COLORS: Record<string, string> = {
  UNPROCESSED: '#64748b',
  NEEDS_VECTOR_EDIT: '#ea580c',
  APPROVED: '#16a34a',
  PENDING: '#f59e0b',
  NEEDS_MANUAL_EDIT: '#f97316',
  READY_TO_PROCESS: '#0ea5e9',
  PROCESSING: '#2563eb',
  COMPLETED: '#16a34a',
  FAILED: '#dc2626',
  CANCELLED: '#6b7280',
};

export function normalizeStatusColors(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(Object.entries(DEFAULT_STATUS_COLORS).map(([status, fallback]) => {
    const candidate = source[status];
    return [status, typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback];
  }));
}
