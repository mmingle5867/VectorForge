'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';

interface BatchSampleItem {
  originalFilename: string;
  baseName: string;
  status: string;
  outputFolderPath: string | null;
}

interface Batch {
  id: string;
  name: string | null;
  status: string;
  itemCount: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  items: BatchSampleItem[];
  firstOutputFolderPath: string | null;
}

const STATUS_FILTERS = ['All', 'Pending', 'Processing', 'Completed', 'Failed', 'Cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function DashboardPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

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

  async function cancelBatch(batchId: string) {
    if (!confirm('Are you sure you want to cancel this batch? Items already completed will be kept.')) {
      return;
    }
    setCancelling(batchId);
    try {
      const res = await fetch(`/api/batches/${batchId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        fetchBatches();
      }
    } catch {
      // Handle error
    } finally {
      setCancelling(null);
    }
  }

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { bg: string; text: string }> = {
      PENDING: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300' },
      PROCESSING: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
      COMPLETED: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
      FAILED: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
      CANCELLED: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-800 dark:text-gray-300' },
    };
    return configs[status] || configs.PENDING;
  };

  const filteredBatches = statusFilter === 'All'
    ? batches
    : batches.filter((batch) => batch.status === statusFilter.toUpperCase());

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
          <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">No batches yet</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Upload your first batch of images to get started.
          </p>
          <Link
            href="/upload"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Upload Images
          </Link>
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
            const progressPercent = itemCount > 0
              ? Math.round((batch.completedItems / itemCount) * 100)
              : 0;
            const isActive = batch.status === 'PROCESSING';
            const outputFolderPath = batch.firstOutputFolderPath || batch.items.find((item) => item.outputFolderPath)?.outputFolderPath;

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
                        {batch.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Created {formatDate(batch.createdAt)}
                      {batch.completedAt && ` - Finished ${formatDate(batch.completedAt)}`}
                    </p>
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {itemCount} items / {batch.completedItems} completed / {batch.failedItems} failed
                    </p>
                    {batch.items.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {batch.items.map((item) => (
                          <span
                            key={`${batch.id}-${item.originalFilename}-${item.baseName}`}
                            className="max-w-full truncate rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                            title={`${item.originalFilename} (${item.status})`}
                          >
                            {item.baseName || item.originalFilename}
                          </span>
                        ))}
                      </div>
                    )}
                    {outputFolderPath && (
                      <p className="mt-3 truncate rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300" title={outputFolderPath}>
                        Output: {outputFolderPath}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {batch.status === 'PENDING' && (
                      <Link
                        href={`/upload/review/${batch.id}`}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                      >
                        Review & Start
                      </Link>
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
                    {batch.status === 'COMPLETED' && (
                      <Link
                        href={`/output/${batch.id}`}
                        className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400 transition-colors"
                      >
                        View Output
                      </Link>
                    )}
                    {batch.status === 'FAILED' && (
                      <Link
                        href={`/output/${batch.id}`}
                        className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 transition-colors"
                      >
                        View Details
                      </Link>
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
                          batch.status === 'COMPLETED'
                            ? 'bg-green-500'
                            : 'bg-blue-600'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
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
