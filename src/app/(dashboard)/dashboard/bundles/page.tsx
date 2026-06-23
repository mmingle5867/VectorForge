'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardCopy, ExternalLink, FolderOpen, Loader2, PackageOpen } from 'lucide-react';

type BundleSummary = {
  bundleId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  bundleFolderName: string;
  bundleFolderPath: string;
  manifestPath: string;
  zipPath: string | null;
  zipFolderPath: string | null;
  manifestStatus: string;
  zipStatus: string;
  packageStatus: string;
  thumbnailPath: string | null;
};

type BundleListResponse = {
  success: boolean;
  bundles: BundleSummary[];
  warnings?: string[];
  error?: string;
};

function formatDateTime(value: string) {
  if (!value) return 'n/a';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function hasTransparentThumbnail(imagePath: string | null) {
  if (!imagePath) return false;
  const extension = `.${imagePath.toLowerCase().split('.').pop() || ''}`;
  return ['.png', '.svg', '.webp'].includes(extension);
}

function ThumbnailFrame({
  bundleId,
  path: imagePath,
  alt,
  className,
}: {
  bundleId: string;
  path: string | null;
  alt: string;
  className?: string;
}) {
  const transparent = hasTransparentThumbnail(imagePath);
  const backgroundClass = transparent
    ? 'bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.16)_1px,transparent_0)] bg-[size:10px_10px] bg-[#2b2b2b]'
    : 'bg-gray-100 dark:bg-gray-900';
  const source = imagePath
    ? `/api/bundles/${encodeURIComponent(bundleId)}/image?path=${encodeURIComponent(imagePath)}`
    : '';

  return imagePath ? (
    <div className={`overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 ${backgroundClass}`}>
      <img
        src={source}
        alt={alt}
        className={className}
      />
    </div>
  ) : (
    <div className="flex h-40 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
      No thumbnail
    </div>
  );
}

export default function BundleDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bundles, setBundles] = useState<BundleSummary[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadBundles() {
      try {
        const response = await fetch('/api/bundles');
        const data = (await response.json()) as BundleListResponse;
        if (!active) return;
        if (data.success) {
          setBundles(data.bundles || []);
          setWarnings(data.warnings || []);
          setError(null);
        } else {
          setError(data.error || 'Failed to load bundles');
        }
      } catch {
        if (active) {
          setError('Failed to load bundles');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadBundles();

    return () => {
      active = false;
    };
  }, []);

  const sortedBundles = useMemo(
    () => [...bundles].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [bundles]
  );

  async function openLocal(action: 'folder' | 'file', outputFolderPath: string, files?: Array<{ type: string; path: string }>) {
    setBusyAction(`${action}:${outputFolderPath}`);
    try {
      const response = await fetch('/api/local-editor/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          outputFolderPath,
          files: files || [],
        }),
      });
      const data = await response.json();
      if (!data.success) {
        setError(data.error || 'Failed to open local path');
      }
    } catch {
      setError('Failed to open local path');
    } finally {
      setBusyAction(null);
    }
  }

  async function copyText(value: string | null | undefined) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Bundles</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Browse generated bundle packages, inspect members, and reopen bundle outputs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/bundles"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            <PackageOpen className="h-4 w-4" />
            Bundle Builder
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {warnings.map((warning, index) => (
            <div key={`${warning}-${index}`}>{warning}</div>
          ))}
        </div>
      )}

      {sortedBundles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          No bundles found in the configured bundle output folder.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sortedBundles.map((bundle) => (
            <div key={bundle.bundleId} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="grid gap-4 p-4 md:grid-cols-[160px,1fr]">
                <ThumbnailFrame
                  bundleId={bundle.bundleId}
                  path={bundle.thumbnailPath}
                  alt={bundle.title}
                  className="h-40 w-full object-contain"
                />

                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{bundle.title}</h2>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                        {bundle.bundleId}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Created {formatDateTime(bundle.createdAt)} · Updated {formatDateTime(bundle.updatedAt)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">Members</div>
                      <div>{bundle.memberCount}</div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">Folder</div>
                      <div className="truncate" title={bundle.bundleFolderPath}>{bundle.bundleFolderName}</div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">ZIP</div>
                      <div>{bundle.zipStatus}</div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">Manifest</div>
                      <div>{bundle.manifestStatus}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/dashboard/bundles/${encodeURIComponent(bundle.bundleId)}`}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open Bundle
                    </Link>
                    <button
                      type="button"
                      onClick={() => openLocal('folder', bundle.bundleFolderPath)}
                      disabled={busyAction === `folder:${bundle.bundleFolderPath}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Open Folder
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText(bundle.manifestPath)}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                    >
                      <ClipboardCopy className="h-4 w-4" />
                      Copy Manifest Path
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
