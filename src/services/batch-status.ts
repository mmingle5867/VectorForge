import prisma from '@/lib/prisma';

const ACTIVE_ITEM_STATUSES = new Set(['UPSCALING', 'CONVERTING', 'GENERATING_FILES', 'ZIPPING']);
const WORKFLOW_ITEM_STATUSES = [
  'PENDING',
  'NEEDS_MANUAL_EDIT',
  'READY_TO_PROCESS',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type WorkflowItemStatus = (typeof WORKFLOW_ITEM_STATUSES)[number];
export type ItemStatusCounts = Record<WorkflowItemStatus, number>;

export function getItemStatusCounts(items: Array<{ status: string }>): ItemStatusCounts {
  const counts = Object.fromEntries(
    WORKFLOW_ITEM_STATUSES.map((status) => [status, 0])
  ) as ItemStatusCounts;

  for (const item of items) {
    if (item.status in counts) {
      counts[item.status as WorkflowItemStatus] += 1;
    } else if (ACTIVE_ITEM_STATUSES.has(item.status)) {
      counts.PROCESSING += 1;
    }
  }

  return counts;
}

export function getBatchSummaryStatus(items: Array<{ status: string }>) {
  const counts = getItemStatusCounts(items);
  const total = items.length;
  const nonCancelled = total - counts.CANCELLED;

  if (total === 0 || counts.PENDING === total) {
    return { status: 'PENDING', label: 'All Pending', counts };
  }
  if (counts.PROCESSING > 0) {
    return { status: 'PROCESSING', label: 'Processing', counts };
  }
  if (counts.FAILED > 0) {
    return { status: 'FAILED', label: counts.FAILED === total ? 'Failed' : 'Mixed', counts };
  }
  if (counts.CANCELLED === total) {
    return { status: 'CANCELLED', label: 'Cancelled', counts };
  }
  if (nonCancelled > 0 && counts.COMPLETED === nonCancelled) {
    return { status: 'COMPLETED', label: counts.CANCELLED > 0 ? 'Partially Completed' : 'Completed', counts };
  }
  if (nonCancelled > 0 && counts.READY_TO_PROCESS === nonCancelled) {
    return { status: 'READY_TO_PROCESS', label: 'Ready To Process', counts };
  }
  if (counts.NEEDS_MANUAL_EDIT > 0) {
    return { status: 'NEEDS_MANUAL_EDIT', label: 'Needs Manual Edit', counts };
  }
  if (counts.PENDING > 0) {
    return { status: 'PENDING', label: 'Needs Review', counts };
  }

  return { status: 'PENDING', label: 'Mixed', counts };
}

export async function recomputeBatchStatus(batchId: string) {
  const items = await prisma.batchItem.findMany({
    where: { batchId },
    select: { status: true },
  });

  const totalItems = items.length;
  const summary = getBatchSummaryStatus(items);

  await prisma.batch.update({
    where: { id: batchId },
    data: {
      totalItems,
      completedItems: summary.counts.COMPLETED,
      failedItems: summary.counts.FAILED,
      status: summary.status as never,
      completedAt: summary.status === 'COMPLETED' || summary.status === 'FAILED' ? new Date() : null,
    },
  });

  return {
    status: summary.status,
    summaryLabel: summary.label,
    totalItems,
    completedItems: summary.counts.COMPLETED,
    failedItems: summary.counts.FAILED,
    needsManualEditItems: summary.counts.NEEDS_MANUAL_EDIT,
    readyToProcessItems: summary.counts.READY_TO_PROCESS,
    processingItems: summary.counts.PROCESSING,
    cancelledItems: summary.counts.CANCELLED,
    counts: summary.counts,
  };
}
