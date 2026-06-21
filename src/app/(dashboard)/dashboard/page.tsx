'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';

type FileKind = 'png' | 'jpg' | 'svg';

interface DashboardFile {
  exists: boolean;
  path: string | null;
}

interface BatchItem {
  id: string;
  originalFilename: string;
  baseName: string;
  status: string;
  errorMsg: string | null;
  outputFolderPath: string | null;
  createdAt: string;
  updatedAt: string;
  files: Record<FileKind, DashboardFile>;
}

interface Batch {
  id: string;
  name: string | null;
  status: string;
  statusLabel?: string;
  statusCounts?: Record<string, number>;
  itemCount: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  items: BatchItem[];
  firstOutputFolderPath: string | null;
}

const STATUS_FILTERS = ['All', 'Pending', 'Needs Manual Edit', 'Ready To Process', 'Processing', 'Completed', 'Failed', 'Cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const WORKFLOW_STATUSES = [
  ['PENDING', 'Pending'],
  ['NEEDS_MANUAL_EDIT', 'Needs Manual Edit'],
  ['READY_TO_PROCESS', 'Ready To Process'],
  ['PROCESSING', 'Processing'],
  ['COMPLETED', 'Completed'],
  ['FAILED', 'Failed'],
  ['CANCELLED', 'Cancelled'],
] as const;

const FILE_LABELS: Record<FileKind, string> = {
  png: 'PNG',
  jpg: 'JPG',
  svg: 'SVG',
};

export default function DashboardPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchBatches();
    const interval = setInterval(fetchBatches, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchBatches() {
    try {
      const res = await fetch('/api/batches');
      const data = await res.json();
      if (data.success) {
        setBatches(data.batches);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }

  function toggleExpanded(batchId: string) {
    setExpandedBatches((current) => {
      const next = new Set(current);
      if (next.has(batchId)) {
        next.delete(batchId);
      } else {
        next.add(batchId);
      }
      return next;
    });
  }

  function itemFiles(item: BatchItem) {
    return (Object.entries(item.files) as [FileKind, DashboardFile][])
      .filter(([, file]) => file.exists && file.path)
      .map(([type, file]) => ({ type, path: file.path as string }));
  }

  async function cancelBatch(batchId: string) {
    if (!confirm('Are you sure you want to cancel this batch? Items already completed will be kept.')) {
      return;
    }
    setCancelling(batchId);
    try {
      const res = await fetch(`/api/batches/${batchId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setNotice('Batch cancelled.');
        fetchBatches();
      } else {
        setNotice(data.error || 'Failed to cancel batch.');
      }
    } catch {
      setNotice('Failed to cancel batch.');
    } finally {
      setCancelling(null);
    }
  }

  async function retryBatch(batchId: string) {
    if (!confirm('Retry failed items in this batch? Completed items will be kept.')) {
      return;
    }

    setBusyAction(`retry:${batchId}`);
    try {
      const res = await fetch(`/api/batches/${batchId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const moved = statusFilter === 'Failed' ? ' It moved to Processing and may disappear from this filter.' : '';
        setNotice(`${data.resetItems || 0} item(s) reset. Batch status: ${data.batchStatus || 'PROCESSING'}.${moved}`);
        fetchBatches();
      } else {
        setNotice(data.error || 'Failed to retry batch.');
      }
    } catch {
      setNotice('Failed to retry batch.');
    } finally {
      setBusyAction(null);
    }
  }

  async function retryItem(batchId: string, itemId: string) {
    if (!confirm('Retry this failed item?')) {
      return;
    }

    setBusyAction(`retry-item:${itemId}`);
    try {
      const res = await fetch(`/api/batches/${batchId}/items/${itemId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const moved = statusFilter === 'Failed' ? ' The batch moved to Processing and may disappear from this filter.' : '';
        setNotice(`${data.message || 'Item retry started.'}${moved}`);
        fetchBatches();
      } else {
        setNotice(data.error || 'Failed to retry item.');
      }
    } catch {
      setNotice('Failed to retry item.');
    } finally {
      setBusyAction(null);
    }
  }

  async function markItemReady(batchId: string, itemId: string) {
    if (!confirm('Mark this item Ready To Process?')) {
      return;
    }

    setBusyAction(`ready-item:${itemId}`);
    try {
      const res = await fetch(`/api/batches/${batchId}/items/${itemId}/manual-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ready_to_process' }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice(`Item marked Ready To Process. Batch status: ${data.batchStatus || 'READY_TO_PROCESS'}.`);
        fetchBatches();
      } else {
        setNotice(data.error || 'Failed to mark item ready.');
      }
    } catch {
      setNotice('Failed to mark item ready.');
    } finally {
      setBusyAction(null);
    }
  }

  async function processItem(batchId: string, itemId: string) {
    setBusyAction(`process-item:${itemId}`);
    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, itemId }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice(data.message || 'Item processed.');
        fetchBatches();
      } else {
        setNotice(data.error || 'Failed to process item.');
      }
    } catch {
      setNotice('Failed to process item.');
    } finally {
      setBusyAction(null);
    }
  }

  async function processBatch(batch: Batch) {
    const itemCount = batch.statusCounts?.READY_TO_PROCESS || 0;
    if (!confirm(`Process ${itemCount} ready item${itemCount === 1 ? '' : 's'} in this batch?`)) {
      return;
    }

    setBusyAction(`process:${batch.id}`);
    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: batch.id }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice(data.message || 'Batch processed.');
        fetchBatches();
      } else {
        setNotice(data.error || 'Failed to process batch.');
      }
    } catch {
      setNotice('Failed to process batch.');
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteBatch(batchId: string, deleteFiles: boolean) {
    const message = deleteFiles
      ? 'Delete this batch database record, its batch upload folder, and all item output folders? This cannot be undone.'
      : 'Delete this batch database record only? Upload and output files will be kept on disk.';

    if (!confirm(message)) {
      return;
    }

    setBusyAction(`${deleteFiles ? 'delete-files' : 'delete'}:${batchId}`);
    try {
      const res = await fetch(`/api/batches/${batchId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteFiles }),
      });
      const data = await res.json();
      if (data.success) {
        const fileSummary = deleteFiles
          ? ` Deleted ${data.deletedPaths?.length || 0} path(s), skipped ${data.skippedPaths?.length || 0}.`
          : '';
        setNotice(`${data.message || 'Batch deleted.'}${fileSummary} It was removed from the dashboard.`);
        fetchBatches();
      } else {
        setNotice(data.error || 'Failed to delete batch.');
      }
    } catch {
      setNotice('Failed to delete batch.');
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteItem(batchId: string, itemId: string, deleteFiles: boolean) {
    const message = deleteFiles
      ? 'Delete this item database record, original upload file, and output folder? This cannot be undone.'
      : 'Delete this item database record only? Upload and output files will be kept on disk.';

    if (!confirm(message)) {
      return;
    }

    setBusyAction(`${deleteFiles ? 'delete-item-files' : 'delete-item'}:${itemId}`);
    try {
      const res = await fetch(`/api/batches/${batchId}/items/${itemId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteFiles }),
      });
      const data = await res.json();
      if (data.success) {
        const fileSummary = deleteFiles
          ? ` Deleted ${data.deletedPaths?.length || 0} path(s), skipped ${data.skippedPaths?.length || 0}.`
          : '';
        setNotice(`${data.message || 'Item deleted.'}${fileSummary}`);
        fetchBatches();
      } else {
        setNotice(data.error || 'Failed to delete item.');
      }
    } catch {
      setNotice('Failed to delete item.');
    } finally {
      setBusyAction(null);
    }
  }

  async function openLocal(action: 'folder' | 'file' | 'editable', outputFolderPath: string, files = itemFilesPlaceholder, fileType?: FileKind) {
    setBusyAction(`${action}:${outputFolderPath}:${fileType || 'all'}`);
    try {
      const res = await fetch('/api/local-editor/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          outputFolderPath,
          files,
          fileType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNotice(action === 'folder' ? 'Output folder opened.' : 'File open request sent.');
      } else {
        setNotice(data.error || 'Failed to open local file.');
      }
    } catch {
      setNotice('Failed to open local file.');
    } finally {
      setBusyAction(null);
    }
  }

  const itemFilesPlaceholder: { type: string; path: string }[] = [];

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { bg: string; text: string }> = {
      PENDING: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300' },
      PROCESSING: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
      NEEDS_MANUAL_EDIT: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300' },
      READY_TO_PROCESS: { bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-800 dark:text-sky-300' },
      COMPLETED: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
      FAILED: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
      CANCELLED: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-800 dark:text-gray-300' },
    };
    return configs[status] || configs.PENDING;
  };

  const filteredBatches = statusFilter === 'All'
    ? batches
    : batches.filter((batch) => batch.status === statusFilter.toUpperCase().replaceAll(' ', '_'));

  const getBatchDisplayName = (batch: Batch) => {
    if (batch.name?.trim()) return batch.name;
    const firstItem = batch.items[0];
    return firstItem?.baseName || firstItem?.originalFilename || `Batch ${batch.id.slice(0, 8)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="h-8 w-8 animate-spin text-blue-600" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            View your batch history, track progress, and download processed files.
          </p>
        </div>
        <Link
          href="/upload"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          + New Batch
        </Link>
      </div>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold uppercase tracking-wide">
            Dismiss
          </button>
        </div>
      )}

      {batches.length > 0 && (
        <div className="mb-6 grid grid-cols-4 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Batches</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{batches.length}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Processing</p>
            <p className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">
              {batches.filter((b) => b.status === 'PROCESSING').length}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Completed</p>
            <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
              {batches.filter((b) => b.status === 'COMPLETED').length}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Items</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
              {batches.reduce((sum, b) => sum + (b.itemCount ?? b.totalItems), 0)}
            </p>
          </div>
        </div>
      )}

      {batches.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Batch Status</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Showing {filteredBatches.length} of {batches.length} batches
            </p>
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          >
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      )}

      {batches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-600">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No batches yet</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Upload your first batch of images to get started.
          </p>
        </div>
      ) : filteredBatches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center dark:border-gray-600">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No matching batches</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Change the status filter to view other batches.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBatches.map((batch) => {
            const statusConfig = getStatusConfig(batch.status);
            const itemCount = batch.itemCount ?? batch.totalItems;
            const progressPercent = itemCount > 0 ? Math.round((batch.completedItems / itemCount) * 100) : 0;
            const isActive = batch.status === 'PROCESSING';
            const outputFolderPath = batch.firstOutputFolderPath || batch.items.find((item) => item.outputFolderPath)?.outputFolderPath;
            const firstManualEditItem = batch.items.find((item) => item.status === 'NEEDS_MANUAL_EDIT');
            const nonCancelledItems = batch.items.filter((item) => item.status !== 'CANCELLED');
            const canProcessBatch =
              nonCancelledItems.length > 0 &&
              nonCancelledItems.every((item) => item.status === 'READY_TO_PROCESS');
            const canDelete = batch.status !== 'PROCESSING';
            const isExpanded = expandedBatches.has(batch.id);

            return (
              <div
                key={batch.id}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-white">
                        {getBatchDisplayName(batch)}
                      </h3>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}>
                        {batch.statusLabel || batch.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Created {formatDate(batch.createdAt)}
                      {batch.completedAt && ` - Finished ${formatDate(batch.completedAt)}`}
                    </p>
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {itemCount} items / {batch.completedItems} completed / {batch.failedItems} failed
                    </p>
                    {batch.statusCounts && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {WORKFLOW_STATUSES.map(([status, label]) => {
                          const count = batch.statusCounts?.[status] || 0;
                          if (count === 0) return null;
                          const countConfig = getStatusConfig(status);
                          return (
                            <span
                              key={status}
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${countConfig.bg} ${countConfig.text}`}
                            >
                              {label}: {count}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {batch.items.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {batch.items.slice(0, 3).map((item) => (
                          <span
                            key={`${batch.id}-${item.id}`}
                            className="max-w-full truncate rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                            title={`${item.originalFilename} (${item.status})`}
                          >
                            {item.baseName || item.originalFilename}
                          </span>
                        ))}
                        {batch.items.length > 3 && (
                          <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                            +{batch.items.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                    {outputFolderPath && (
                      <p className="mt-3 truncate rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300" title={outputFolderPath}>
                        First output: {outputFolderPath}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      onClick={() => toggleExpanded(batch.id)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                    >
                      {isExpanded ? 'Hide Items' : 'Show Items'}
                    </button>
                    {outputFolderPath && (
                      <button
                        onClick={() => openLocal('folder', outputFolderPath)}
                        disabled={busyAction === `folder:${outputFolderPath}:all`}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                      >
                        Open Output Folder
                      </button>
                    )}
                    {batch.status === 'PENDING' && (
                      <Link
                        href={`/upload/review/${batch.id}`}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                      >
                        Review & Start
                      </Link>
                    )}
                    {canProcessBatch && (
                      <button
                        onClick={() => processBatch(batch)}
                        disabled={busyAction === `process:${batch.id}`}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        Start Conversion
                      </button>
                    )}
                    {batch.status === 'PROCESSING' && (
                      <>
                        <Link
                          href={`/processing/${batch.id}`}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                        >
                          View Progress
                        </Link>
                        <button
                          onClick={() => cancelBatch(batch.id)}
                          disabled={cancelling === batch.id}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400 transition-colors"
                        >
                          {cancelling === batch.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      </>
                    )}
                    {batch.status === 'NEEDS_MANUAL_EDIT' && (
                      <Link
                        href={`/upload/review/${batch.id}${firstManualEditItem ? `?itemId=${firstManualEditItem.id}` : ''}`}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400 transition-colors"
                      >
                        Continue Editing
                      </Link>
                    )}
                    {batch.status === 'COMPLETED' && (
                      <Link
                        href={`/output/${batch.id}`}
                        className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400 transition-colors"
                      >
                        View Output
                      </Link>
                    )}
                    {batch.status === 'FAILED' && (
                      <>
                        <button
                          onClick={() => retryBatch(batch.id)}
                          disabled={busyAction === `retry:${batch.id}`}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                        >
                          Retry Failed Batch
                        </button>
                        <Link
                          href={`/output/${batch.id}`}
                          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 transition-colors"
                        >
                          View Details
                        </Link>
                      </>
                    )}
                    {canDelete && (
                      <>
                        <button
                          onClick={() => deleteBatch(batch.id, false)}
                          disabled={busyAction === `delete:${batch.id}`}
                          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 transition-colors"
                        >
                          Delete Batch
                        </button>
                        <button
                          onClick={() => deleteBatch(batch.id, true)}
                          disabled={busyAction === `delete-files:${batch.id}`}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400 transition-colors"
                        >
                          Delete Batch + Files
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {(isActive || batch.status === 'COMPLETED') && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {batch.completedItems} of {itemCount} completed
                        {batch.failedItems > 0 && ` (${batch.failedItems} failed)`}
                      </span>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {progressPercent}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          batch.status === 'COMPLETED' ? 'bg-green-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
                    {batch.items.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">No items remain in this batch.</p>
                    ) : (
                      batch.items.map((item) => {
                        const files = itemFiles(item);
                        const itemCanDelete = batch.status !== 'PROCESSING';

                        return (
                          <div key={item.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                                    {item.originalFilename}
                                  </p>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusConfig(item.status).bg} ${getStatusConfig(item.status).text}`}>
                                    {item.status}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-300">Base name: {item.baseName}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  Created {formatDate(item.createdAt)} - Updated {formatDate(item.updatedAt)}
                                </p>
                                {item.errorMsg && (
                                  <p className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                                    Error: {item.errorMsg}
                                  </p>
                                )}
                                {item.outputFolderPath && (
                                  <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={item.outputFolderPath}>
                                    Output: {item.outputFolderPath}
                                  </p>
                                )}
                                <p className="text-xs text-gray-600 dark:text-gray-300">
                                  Outputs: SVG {item.files.svg.exists ? 'yes' : 'no'} / PNG {item.files.png.exists ? 'yes' : 'no'} / JPG {item.files.jpg.exists ? 'yes' : 'no'}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                                {item.outputFolderPath && (
                                  <button
                                    onClick={() => openLocal('folder', item.outputFolderPath!)}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                                  >
                                    Open Output Folder
                                  </button>
                                )}
                                {(Object.keys(FILE_LABELS) as FileKind[]).map((type) => (
                                  item.files[type].exists && item.outputFolderPath ? (
                                    <button
                                      key={type}
                                      onClick={() => openLocal('file', item.outputFolderPath!, files, type)}
                                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                                    >
                                      Open {FILE_LABELS[type]}
                                    </button>
                                  ) : null
                                ))}
                                {files.length > 0 && item.outputFolderPath && (
                                  <button
                                    onClick={() => openLocal('editable', item.outputFolderPath!, files)}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                                  >
                                    Open Editable Files
                                  </button>
                                )}
                                {item.status === 'PENDING' && (
                                  <Link
                                    href={`/upload/review/${batch.id}?itemId=${item.id}`}
                                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                                  >
                                    Review/Tune
                                  </Link>
                                )}
                                {item.status === 'NEEDS_MANUAL_EDIT' && (
                                  <Link
                                    href={`/upload/review/${batch.id}?itemId=${item.id}`}
                                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400 transition-colors"
                                  >
                                    Continue Editing
                                  </Link>
                                )}
                                {item.status === 'FAILED' && (
                                  <button
                                    onClick={() => retryItem(batch.id, item.id)}
                                    disabled={busyAction === `retry-item:${item.id}`}
                                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                                  >
                                    Retry Item
                                  </button>
                                )}
                                {['READY_TO_PROCESS', 'NEEDS_MANUAL_EDIT', 'COMPLETED'].includes(item.status) && (
                                  <Link
                                    href={`/upload/review/${batch.id}?itemId=${item.id}`}
                                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                                  >
                                    Reopen Preview/Tune
                                  </Link>
                                )}
                                {item.status === 'FAILED' && (
                                  <Link
                                    href={`/upload/review/${batch.id}?itemId=${item.id}`}
                                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400 transition-colors"
                                  >
                                    Continue Editing
                                  </Link>
                                )}
                                {item.status === 'NEEDS_MANUAL_EDIT' && (
                                  <button
                                    onClick={() => markItemReady(batch.id, item.id)}
                                    disabled={busyAction === `ready-item:${item.id}`}
                                    className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400 transition-colors"
                                  >
                                    Mark Ready To Process
                                  </button>
                                )}
                                {item.status === 'READY_TO_PROCESS' && (
                                  <button
                                    onClick={() => processItem(batch.id, item.id)}
                                    disabled={busyAction === `process-item:${item.id}`}
                                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                                  >
                                    Process Item
                                  </button>
                                )}
                                {itemCanDelete && (
                                  <>
                                    <button
                                      onClick={() => deleteItem(batch.id, item.id, false)}
                                      disabled={busyAction === `delete-item:${item.id}`}
                                      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 transition-colors"
                                    >
                                      Delete Item
                                    </button>
                                    <button
                                      onClick={() => deleteItem(batch.id, item.id, true)}
                                      disabled={busyAction === `delete-item-files:${item.id}`}
                                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400 transition-colors"
                                    >
                                      Delete Item + Files
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
