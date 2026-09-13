const activeArtworkMutations = new Set<string>();

export async function withArtworkMutationLock<T>(
  batchItemId: string,
  operation: string,
  callback: () => Promise<T>
) {
  if (activeArtworkMutations.has(batchItemId)) {
    throw new Error(`This artwork is already being ${operation}`);
  }
  activeArtworkMutations.add(batchItemId);
  try {
    return await callback();
  } finally {
    activeArtworkMutations.delete(batchItemId);
  }
}
