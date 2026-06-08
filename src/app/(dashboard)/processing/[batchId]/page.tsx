'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatBytes } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface BatchItemProgress {
  id: string;
  originalFilename: string;
  baseName: string;
  status: string;
  progress: number;
  currentStep: string | null;
  sku: string | null;
  errorMsg: string | null;
}

interface BatchProgress {
  batchId: string;
  status: string;
  completedItems: number;
  failedItems: number;
  totalItems: number;
  items: BatchItemProgress[];
}

// ============================================================================
// Status Badge Component
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    PENDING: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', label: 'Pending' },
    QUEUED: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: 'Queued' },
    UPSCALING: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-400', label: 'Upscaling' },
    CONVERTING: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400', label: 'Converting' },
    GENERATING_FILES: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', label: 'Generating' },
    ZIPPING: { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-400', label: 'Zipping' },
    COMPLETED: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', label: 'Done' },
    FAILED: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', label: 'Failed' },
    PROCESSING: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: 'Processing' },
  };

  const c = config[status] || config.PENDING;

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

// ============================================================================
// Progress Bar Component
// ============================================================================

function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 ${className}`}>
      <div
        className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out dark:bg-blue-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

// ============================================================================
// Main Processing Page
// ============================================================================

export default function ProcessingPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.batchId as string;

  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Timer for elapsed time
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  // SSE Connection
  useEffect(() => {
    const eventSource = new EventSource(`/api/batches/${batchId}/progress`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('connected', () => {
      setConnected(true);
      setError(null);
    });

    eventSource.addEventListener('progress', (event) => {
      try {
        const data = JSON.parse(event.data) as BatchProgress;
        setProgress(data);
      } catch {
        // Ignore parse errors
      }
    });

    eventSource.addEventListener('complete', (event) => {
      try {
        const data = JSON.parse(event.data);
        setProgress((prev) => prev ? { ...prev, ...data } : null);
      } catch {
        // Ignore parse errors
      }
      eventSource.close();
    });

    eventSource.addEventListener('error', (event) => {
      if (eventSource.readyState === EventSource.CLOSED) {
        setConnected(false);
      }
    });

    eventSource.onerror = () => {
      setConnected(false);
      setError('Connection lost. Reconnecting...');
    };

    return () => {
      eventSource.close();
    };
  }, [batchId]);

  // Calculate overall progress
  const overallProgress = progress
    ? progress.totalItems > 0
      ? Math.round(
          ((progress.completedItems + progress.failedItems) / progress.totalItems) * 100
        )
      : 0
    : 0;

  const isComplete = progress?.status === 'COMPLETED' || progress?.status === 'FAILED';

  // Format elapsed time
  const formatElapsed = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {isComplete ? 'Processing Complete' : 'Processing Batch...'}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Batch ID: {batchId}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Connection indicator */}
            <span className={`flex items-center gap-1.5 text-xs ${connected ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              {connected ? 'Live' : 'Disconnected'}
            </span>
            {/* Elapsed time */}
            <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-mono text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              ⏱ {formatElapsed(elapsed)}
            </span>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Overall Progress Card */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Overall Progress
            </h2>
            {progress && <StatusBadge status={progress.status} />}
          </div>
          <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {overallProgress}%
          </span>
        </div>

        <ProgressBar value={overallProgress} className="mb-3" />

        {/* Stats Row */}
        {progress && (
          <div className="grid grid-cols-4 gap-4">
            <div className="rounded-lg bg-gray-50 p-3 text-center dark:bg-gray-700/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{progress.totalItems}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 text-center dark:bg-blue-900/20">
              <p className="text-xs text-blue-600 dark:text-blue-400">Processing</p>
              <p className="text-lg font-bold text-blue-700 dark:text-blue-300">
                {progress.totalItems - progress.completedItems - progress.failedItems}
              </p>
            </div>
            <div className="rounded-lg bg-green-50 p-3 text-center dark:bg-green-900/20">
              <p className="text-xs text-green-600 dark:text-green-400">Completed</p>
              <p className="text-lg font-bold text-green-700 dark:text-green-300">{progress.completedItems}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 text-center dark:bg-red-900/20">
              <p className="text-xs text-red-600 dark:text-red-400">Failed</p>
              <p className="text-lg font-bold text-red-700 dark:text-red-300">{progress.failedItems}</p>
            </div>
          </div>
        )}
      </div>

      {/* Individual Items */}
      {progress && progress.items.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Items ({progress.items.length})
            </h2>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {progress.items.map((item) => (
              <div key={item.id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {item.baseName}
                    </span>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    {item.sku && (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                        {item.sku}
                      </span>
                    )}
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {item.progress}%
                    </span>
                  </div>
                </div>

                <ProgressBar value={item.progress} className="mb-1" />

                {/* Current step or error */}
                {item.currentStep && item.status !== 'COMPLETED' && item.status !== 'FAILED' && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 animate-pulse">
                    {item.currentStep}
                  </p>
                )}
                {item.errorMsg && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    ❌ {item.errorMsg}
                  </p>
                )}
                {item.status === 'COMPLETED' && (
                  <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                    ✅ Complete
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completion Actions */}
      {isComplete && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
          >
            ← Back to Dashboard
          </button>
          <button
            onClick={() => router.push(`/output/${batchId}`)}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            📁 View Output Files
          </button>
        </div>
      )}

      {/* Loading State */}
      {!progress && !error && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <svg className="mx-auto h-10 w-10 animate-spin text-blue-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Connecting to processing stream...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}