'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatBytes, formatDate } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface FileInfo {
  name: string;
  size: number;
  sizeFormatted: string;
  type: string;
}

interface OutputItem {
  id: string;
  baseName: string;
  sku: string | null;
  status: string;
  outputFolderPath: string | null;
  zipPath: string | null;
  files: FileInfo[];
  folderSize: number;
  zipSize: number;
}

interface BatchInfo {
  id: string;
  name: string | null;
  status: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  createdAt: string;
  completedAt: string | null;
}

interface OutputData {
  batch: BatchInfo;
  items: OutputItem[];
  totals: {
    folderSize: number;
    folderSizeFormatted: string;
    zipSize: number;
    zipSizeFormatted: string;
    fileCount: number;
  };
}

// ============================================================================
// File Icon Component
// ============================================================================

function FileIcon({ type }: { type: string }) {
  const colors: Record<string, string> = {
    vector: 'text-purple-500',
    image: 'text-blue-500',
    cad: 'text-orange-500',
    text: 'text-gray-500',
    archive: 'text-green-500',
    video: 'text-red-500',
    other: 'text-gray-400',
  };

  return (
    <svg className={`h-4 w-4 ${colors[type] || colors.other}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function basename(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

// ============================================================================
// Main Output Page
// ============================================================================

export default function OutputPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.batchId as string;

  const [data, setData] = useState<OutputData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOutput() {
      try {
        const res = await fetch(`/api/batches/${batchId}/output`);
        const json = await res.json();
        if (json.success) {
          setData(json);
          // Auto-expand first 5 items
          const firstFive = json.items.slice(0, 5).map((i: OutputItem) => i.id);
          setExpandedItems(new Set(firstFive));
        } else {
          setError(json.error || 'Failed to load output');
        }
      } catch {
        setError('Failed to load output data');
      } finally {
        setLoading(false);
      }
    }

    fetchOutput();
  }, [batchId]);

  const toggleItem = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (data) {
      setExpandedItems(new Set(data.items.map((i) => i.id)));
    }
  };

  const collapseAll = () => {
    setExpandedItems(new Set());
  };

  const downloadItem = async (itemId: string, baseName: string, zipPath: string | null) => {
    setDownloading(itemId);
    try {
      const res = await fetch(`/api/batches/${batchId}/download?itemId=${itemId}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipPath ? basename(zipPath) : `${baseName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      // Handle error
    } finally {
      setDownloading(null);
    }
  };

  const downloadAll = async () => {
    setDownloading('all');
    try {
      const res = await fetch(`/api/batches/${batchId}/download`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${data?.batch.name || 'batch'}_all.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      // Handle error
    } finally {
      setDownloading(null);
    }
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

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <svg className="mx-auto h-12 w-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
          {error || 'Output not found'}
        </h2>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-800">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            📁 Output Files
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {data.batch.name || `Batch ${batchId.slice(0, 8)}`} • {formatDate(data.batch.completedAt || data.batch.createdAt)}
          </p>
        </div>
        <button
          onClick={downloadAll}
          disabled={downloading === 'all'}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {downloading === 'all' ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Preparing...
            </>
          ) : (
            <>📥 Download All</>
          )}
        </button>
      </div>

      {/* Summary Card */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">Items</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{data.batch.completedItems}</p>
          <p className="text-[10px] text-gray-400">completed</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">Files</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{data.totals.fileCount}</p>
          <p className="text-[10px] text-gray-400">generated</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">Folder Size</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{data.totals.folderSizeFormatted}</p>
          <p className="text-[10px] text-gray-400">uncompressed</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">ZIP Size</p>
          <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{data.totals.zipSizeFormatted}</p>
          <p className="text-[10px] text-gray-400">compressed</p>
        </div>
      </div>

      {/* Expand/Collapse Controls */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          Items ({data.items.length})
        </h2>
        <div className="flex gap-2">
          <button onClick={expandAll} className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400">
            Expand All
          </button>
          <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
          <button onClick={collapseAll} className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400">
            Collapse All
          </button>
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-3">
        {data.items.map((item) => {
          const isExpanded = expandedItems.has(item.id);
          const isCompleted = item.status === 'COMPLETED';

          return (
            <div
              key={item.id}
              className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-700 dark:bg-gray-800"
            >
              {/* Item Header */}
              <button
                onClick={() => toggleItem(item.id)}
                className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {item.baseName}
                    </span>
                    {item.sku && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                        {item.sku}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {item.files.length} files • {formatBytes(item.folderSize)}
                  </span>
                  {isCompleted ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                      <svg className="h-3 w-3 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                      <svg className="h-3 w-3 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}
                </div>
              </button>

              {/* Item Expanded Content */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-700">
                  {/* File List */}
                  {item.files.length > 0 ? (
                    <div className="space-y-1.5">
                      {item.files.map((file) => (
                        <div
                          key={file.name}
                          className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-700/50"
                        >
                          <div className="flex items-center gap-2">
                            <FileIcon type={file.type} />
                            <span className="text-xs font-mono text-gray-800 dark:text-gray-200">
                              {file.name}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {file.sizeFormatted}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      No output files available.
                    </p>
                  )}

                  {/* Download Button */}
                  {isCompleted && item.zipPath && (
                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-gray-700">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        ZIP: {formatBytes(item.zipSize)}
                      </span>
                      <button
                        onClick={() => downloadItem(item.id, item.baseName, item.zipPath)}
                        disabled={downloading === item.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition-colors"
                      >
                        {downloading === item.id ? 'Downloading...' : '📥 Download ZIP'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Actions */}
      <div className="mt-8 flex items-center justify-center gap-4">
        <Link
          href="/dashboard"
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          ← Back to Dashboard
        </Link>
        <Link
          href="/upload"
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          + New Batch
        </Link>
      </div>
    </div>
  );
}
