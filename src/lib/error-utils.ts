export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {
      name: error.name,
      message: error.message || error.name || 'Error',
    };

    if (error.stack) {
      details.stack = error.stack;
    }

    const maybeError = error as Error & Record<string, unknown>;
    for (const key of ['code', 'errno', 'syscall', 'path', 'address', 'port'] as const) {
      if (maybeError[key] !== undefined) {
        details[key] = maybeError[key];
      }
    }

    if (maybeError.cause !== undefined) {
      details.cause =
        maybeError.cause instanceof Error ? serializeError(maybeError.cause) : maybeError.cause;
    }

    return details;
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return { message: String(error) };
  }

  if (error && typeof error === 'object') {
    return { ...(error as Record<string, unknown>) };
  }

  return { message: 'Unknown error' };
}

