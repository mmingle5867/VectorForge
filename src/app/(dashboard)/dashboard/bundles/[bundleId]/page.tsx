'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ClipboardCopy, FolderOpen, Loader2, RotateCcw, CopyPlus, FileText } from 'lucide-react';

type BundleMember = {
  sortOrder: number;
  packageId: string;
  artworkId: string;
  profileId: string;
  productTitle: string;
  sourceManifestPath: string;
  sourcePackagePath: string;
  bundleFolder: string;
  includedFiles: Array<{
    role: string;
    sourcePath: string;
    bundlePath: string;
    format: string;
    sizeBytes?: number;
  }>;
  thumbnailPath: string | null;
};

type BundleDetail = {
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
  readmePath: string | null;
  licensePath: string | null;
  members: BundleMember[];
};

type BundleDetailResponse = {
  success: boolean;
  bundle?: BundleDetail;
  error?: string;
};

type ActionResult = {
  success: boolean;
  bundleId?: string;
  bundleFolderPath?: string;
  manifestPath?: string;
  readmePath?: string;
  licensePath?: string;
  zipPath?: string;
  warnings?: string[];
  errors?: string[];
  error?: string;
};

function formatDateTime(value: string) {
  if (!value) return 'n/a';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function BundleDetailPage() {
  const params = useParams<{ bundleId: string }>();
  const [bundleId, setBundleId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<BundleDetail | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    setBundleId(typeof params?.bundleId === 'string' ? params.bundleId : '');
  }, [params]);

  useEffect(() => {
    if (!bundleId) return;

    let active = true;
    async function loadBundle() {
      try {
        const response = await fetch(`/api/bundles/${encodeURIComponent(bundleId)}`);
        const data = (await response.json()) as BundleDetailResponse;
        if (!active) return;
        if (data.success && data.bundle) {
          setBundle(data.bundle);
          setError(null);
        } else {
          setError(data.error || 'Failed to load bundle');
        }
      } catch {
        if (active) {
          setError('Failed to load bundle');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadBundle();
    return () => {
      active = false;
    };
  }, [bundleId]);

  const memberImagePaths = useMemo(
    () =>
      (bundle?.members || []).map((member) => ({
        ...member,
        previewPath: member.thumbnailPath || member.includedFiles.find((file) => file.bundlePath)?.bundlePath || null,
      })),
    [bundle]
  );

  async function openLocal(action: 'folder' | 'file', outputFolderPath: string, files?: Array<{ type: string; path: string }>) {
    setBusyAction(`${action}:${outputFolderPath}`);
    setActionMessage(null);
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
    setActionMessage('Copied path to clipboard.');
  }

  async function regenerateBundle(copy = false) {
    if (!bundleId) return;
    setBusyAction(copy ? 'duplicate' : 'regenerate');
    setActionMessage(null);
    setError(null);

    try {
      const response = await fetch(
        copy ? `/api/bundles/${encodeURIComponent(bundleId)}/duplicate` : `/api/bundles/${encodeURIComponent(bundleId)}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(copy ? { bundleTitle: `${bundle?.title || bundleId} Copy` } : {}),
        }
      );
      const data = (await response.json()) as ActionResult;
      if (data.success) {
        setActionMessage(copy ? 'Bundle duplicated.' : 'Bundle regenerated.');
        setBundle(null);
        const reload = await fetch(`/api/bundles/${encodeURIComponent(data.bundleId || bundleId)}`);
        const reloadData = (await reload.json()) as BundleDetailResponse;
        if (reloadData.success && reloadData.bundle) {
          setBundle(reloadData.bundle);
          setBundleId(reloadData.bundle.bundleId);
        }
      } else {
        setError(data.error || (Array.isArray(data.errors) ? data.errors.join('\n') : 'Bundle action failed'));
      }
    } catch {
      setError('Bundle action failed');
    } finally {
      setBusyAction(null);
    }
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
          <Link href="/dashboard/bundles" className="mb-2 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
            <ArrowLeft className="h-4 w-4" />
            Back to Bundles
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{bundle?.title || bundleId || 'Bundle'}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {bundle?.bundleId || bundleId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/bundles"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            Bundle Builder
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {actionMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          {actionMessage}
        </div>
      )}

      {bundle && (
        <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900">
              {bundle.thumbnailPath ? (
                <img
                  src={`/api/bundles/${encodeURIComponent(bundle.bundleId)}/image?path=${encodeURIComponent(bundle.thumbnailPath)}`}
                  alt={bundle.title}
                  className="h-56 w-full object-contain"
                />
              ) : (
                <div className="flex h-56 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                  No thumbnail
                </div>
              )}
            </div>

            <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <div><span className="font-medium text-gray-900 dark:text-white">Bundle ID:</span> {bundle.bundleId}</div>
              <div><span className="font-medium text-gray-900 dark:text-white">Title:</span> {bundle.title}</div>
              <div><span className="font-medium text-gray-900 dark:text-white">Created:</span> {formatDateTime(bundle.createdAt)}</div>
              <div><span className="font-medium text-gray-900 dark:text-white">Updated:</span> {formatDateTime(bundle.updatedAt)}</div>
              <div><span className="font-medium text-gray-900 dark:text-white">Members:</span> {bundle.memberCount}</div>
              <div><span className="font-medium text-gray-900 dark:text-white">ZIP Status:</span> {bundle.zipStatus}</div>
              <div><span className="font-medium text-gray-900 dark:text-white">Manifest Status:</span> {bundle.manifestStatus}</div>
              <div className="break-all"><span className="font-medium text-gray-900 dark:text-white">ZIP Path:</span> {bundle.zipPath || 'n/a'}</div>
              <div className="break-all"><span className="font-medium text-gray-900 dark:text-white">Manifest Path:</span> {bundle.manifestPath}</div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => openLocal('folder', bundle.bundleFolderPath)}
                disabled={busyAction === `folder:${bundle.bundleFolderPath}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                <FolderOpen className="h-4 w-4" />
                Open Bundle Folder
              </button>
              <button
                type="button"
                onClick={() => openLocal('folder', bundle.zipFolderPath || bundle.bundleFolderPath)}
                disabled={!(bundle.zipFolderPath || bundle.bundleFolderPath) || busyAction === `folder:${bundle.zipFolderPath || bundle.bundleFolderPath}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                <FolderOpen className="h-4 w-4" />
                Open ZIP Folder
              </button>
              <button
                type="button"
                onClick={() => openLocal('file', bundle.bundleFolderPath, [{ type: 'manifest', path: bundle.manifestPath }])}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                <FileText className="h-4 w-4" />
                Open Manifest
              </button>
              <button
                type="button"
                onClick={() => regenerateBundle(false)}
                disabled={busyAction === 'regenerate'}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Regenerate Bundle
              </button>
              <button
                type="button"
                onClick={() => regenerateBundle(true)}
                disabled={busyAction === 'duplicate'}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
              >
                <CopyPlus className="h-4 w-4" />
                Duplicate Bundle
              </button>
              <button
                type="button"
                onClick={() => copyText(bundle.manifestPath)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                <ClipboardCopy className="h-4 w-4" />
                Copy Manifest Path
              </button>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Members</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">Member thumbnails are shown from the first included file for each package.</p>
            </div>

            <div className="space-y-4">
              {memberImagePaths.map((member) => {
                const previewPath = member.previewPath;
                return (
                  <div key={`${member.sortOrder}-${member.packageId}`} className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40 lg:grid-cols-[160px,1fr]">
                    <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950">
                      {previewPath ? (
                        <img
                          src={`/api/bundles/${encodeURIComponent(bundle.bundleId)}/image?path=${encodeURIComponent(previewPath)}`}
                          alt={member.productTitle}
                          className="h-40 w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-40 items-center justify-center text-xs text-gray-500 dark:text-gray-400">
                          No thumbnail
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">{member.productTitle}</h3>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                          #{member.sortOrder}
                        </span>
                      </div>
                      <div><span className="font-medium text-gray-900 dark:text-white">Package ID:</span> {member.packageId}</div>
                      <div><span className="font-medium text-gray-900 dark:text-white">Artwork ID:</span> {member.artworkId}</div>
                      <div><span className="font-medium text-gray-900 dark:text-white">Profile ID:</span> {member.profileId}</div>
                      <div className="break-all"><span className="font-medium text-gray-900 dark:text-white">Member Folder:</span> {member.bundleFolder}</div>
                      <div className="break-all"><span className="font-medium text-gray-900 dark:text-white">Source Manifest:</span> {member.sourceManifestPath}</div>
                      <div className="break-all"><span className="font-medium text-gray-900 dark:text-white">Source Package:</span> {member.sourcePackagePath}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Included files: {member.includedFiles.map((file) => file.bundlePath).join(' · ')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
