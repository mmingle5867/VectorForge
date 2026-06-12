import prisma from '@/lib/prisma';

const ACTIVE_ITEM_STATUSES = new Set(['UPSCALING', 'CONVERTING', 'GENERATING_FILES', 'ZIPPING']);

export async function recomputeBatchStatus(batchId: string) {
  const items = await prisma.batchItem.findMany({
    where: { batchId },
    select: { status: true },
  });

  const totalItems = items.length;
  const completedItems = items.filter((item) => item.status === 'COMPLETED').length;
  const failedItems = items.filter((item) => item.status === 'FAILED').length;
  const needsManualEditItems = items.filter((item) => item.status === 'NEEDS_MANUAL_EDIT').length;
  const activeItems = items.filter((item) => ACTIVE_ITEM_STATUSES.has(item.status)).length;
  const pendingItems = items.filter((item) => item.status === 'PENDING').length;

  const status =
    totalItems === 0
      ? 'PENDING'
      : activeItems > 0
        ? 'PROCESSING'
        : pendingItems > 0
            ? 'PENDING'
            : needsManualEditItems > 0
              ? 'NEEDS_MANUAL_EDIT'
              : failedItems === totalItems
                ? 'FAILED'
                : 'COMPLETED';

  await prisma.batch.update({
    where: { id: batchId },
    data: {
      totalItems,
      completedItems,
      failedItems,
      status: status as any,
      completedAt: status === 'COMPLETED' || status === 'FAILED' ? new Date() : null,
    },
  });

  return {
    status,
    totalItems,
    completedItems,
    failedItems,
    needsManualEditItems,
  };
}
