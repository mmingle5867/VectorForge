'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardCopy,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';

type BundleSource = {
  batchId: string;
  batchName: string | null;
  batchStatus: string;
  itemId: string;
  itemStatus: string;
  originalFilename: string;
  baseName: string;
  outputFolderPath: string | null;
  manifestPath: string | null;
  packageId: string;
  artworkId: string;
  profileId: string;
  title: string;
  packageType: string;
  readiness: boolean | string;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  warnings: string[];
  errors: string[];
};

type BundleResult = {
  success: boolean;
  bundleId?: string;
  bundleFolderPath?: string;
  manifestPath?: string;
  readmePath?: string;
  licensePath?: string;
  zipPath?: string;
  warnings?: string[];
  errors?: string[];
  plan?: {
    bundleId?: string;
    memberCount: number;
    members: Array<{
      packageId: string;
      productTitle: string;
      bundleFolder: string;
    }>;
  };
};

type SelectedBundleEntry = {
  manifestPath: string;
  source: BundleSource | null;
};

function getLastPathSegment(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || value;
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const tones: Record<typeof tone, string> = {
    good: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    bad: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  };

  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function hasTransparentThumbnail(imagePath: string | null) {
  if (!imagePath) return false;
  const extension = `.${imagePath.toLowerCase().split('.').pop() || ''}`;
  return ['.png', '.svg', '.webp'].includes(extension);
}

function PackageThumbnail({
  src,
  path: imagePath,
  alt,
  selected,
}: {
  src: string | null;
  path: string | null;
  alt: string;
  selected?: boolean;
}) {
  const transparent = hasTransparentThumbnail(imagePath);
  const backgroundClass = transparent
    ? 'bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.16)_1px,transparent_0)] bg-[size:10px_10px] bg-[#2b2b2b]'
    : 'bg-gray-100 dark:bg-gray-900';

  const content = src ? (
    <img src={src} alt={alt} className="h-full w-full object-contain" />
  ) : (
    <div className="flex h-full items-center justify-center text-xs text-gray-500 dark:text-gray-400">No thumbnail</div>
  );

  return (
    <div
      className={`relative overflow-hidden rounded-lg border text-left transition ${
        selected
          ? 'border-blue-500 ring-2 ring-blue-500/30 dark:border-blue-400'
          : 'border-gray-200 hover:border-blue-300 dark:border-gray-700'
      } ${backgroundClass}`}
      title={alt}
    >
      <div className="relative h-40 w-full">{content}</div>
      {selected && (
        <div className="absolute right-2 top-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
          Selected
        </div>
      )}
    </div>
  );
}

export default function BundlesPage() {
  const [sources, setSources] = useState<BundleSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [bundleTitle, setBundleTitle] = useState('');
  const [bundleNotes, setBundleNotes] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [manualPath, setManualPath] = useState('');
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<BundleResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSources() {
      try {
        const res = await fetch('/api/bundles/sources');
        const data = await res.json();
        if (data.success) {
          setSources(data.packages || []);
        } else {
          setLoadingError(data.error || 'Failed to load completed packages');
        }
      } catch {
        setLoadingError('Failed to load completed packages');
      } finally {
        setLoading(false);
      }
    }

    loadSources();
  }, []);

  const packageMap = useMemo(() => {
    const map = new Map<string, BundleSource>();
    for (const item of sources) {
      if (item.manifestPath) {
        map.set(item.manifestPath, item);
      }
    }
    return map;
  }, [sources]);

  const filteredSources = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sources;

    return sources.filter((source) => {
      const haystack = [
        source.title,
        source.baseName,
        source.packageId,
        source.artworkId,
        source.profileId,
        source.outputFolderPath,
        source.manifestPath,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [search, sources]);

  const selectedSources = useMemo(
    () =>
      selectedPaths.map((manifestPath) => ({
        manifestPath,
        source: packageMap.get(manifestPath) || null,
      })),
    [packageMap, selectedPaths]
  );

  const selectionValidation = useMemo(() => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const validSelectedSources = selectedSources.filter(({ manifestPath, source }) => {
      if (!manifestPath) {
        errors.push('A selected package is missing a manifest path.');
        return false;
      }

      if (!source) {
        errors.push(`Selected manifest was not found: ${manifestPath}`);
        return false;
      }

      if (source.packageType === 'bundle-package') {
        errors.push(`Bundle packages cannot be used as bundle members: ${source.packageId || manifestPath}`);
        return false;
      }

      if (!source.manifestPath) {
        errors.push(`Selected package is missing its resolved manifest path: ${source.title || manifestPath}`);
        return false;
      }

      if (!source.outputFolderPath) {
        errors.push(`Selected package is missing an output folder path: ${source.title || manifestPath}`);
        return false;
      }

      if (source.errors.length > 0) {
        errors.push(`${source.title || source.packageId || manifestPath} has blocking errors: ${source.errors.join(' · ')}`);
        return false;
      }

      if (source.warnings.length > 0) {
        warnings.push(`${source.title || source.packageId || manifestPath}: ${source.warnings.join(' · ')}`);
      }

      if (source.readiness === false) {
        warnings.push(`${source.title || source.packageId || manifestPath} is not marked ready.`);
      }

      return true;
    });

    if (!bundleTitle.trim()) {
      errors.push('Enter a bundle title.');
    }

    if (selectedSources.length > 0 && validSelectedSources.length < 2) {
      errors.push('Select at least 2 completed packages.');
    }

    return {
      validSelectedSources,
      warnings,
      errors,
      canGenerate: bundleTitle.trim().length > 0 && validSelectedSources.length >= 2 && errors.length === 0,
    };
  }, [bundleTitle, selectedSources]);

  function toggleSelected(manifestPath: string) {
    if (!manifestPath) return;
    setSelectedPaths((current) =>
      current.includes(manifestPath)
        ? current.filter((entry) => entry !== manifestPath)
        : [...current, manifestPath]
    );
  }

  function addManualPath() {
    const next = manualPath.trim();
    if (!next) return;
    setSelectedPaths((current) => (current.includes(next) ? current : [...current, next]));
    setManualPath('');
  }

  function removeSelected(index: number) {
    setSelectedPaths((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function moveSelected(index: number, direction: -1 | 1) {
    setSelectedPaths((current) => {
      const next = [...current];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= next.length) return current;
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  async function copyText(value: string | null | undefined) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  async function openBundleFolder() {
    if (!result?.bundleFolderPath) return;
    const response = await fetch('/api/local-editor/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'folder',
        outputFolderPath: result.bundleFolderPath,
      }),
    });
    const data = await response.json();
    if (!data.success) {
      setResultError(data.error || 'Failed to open bundle folder');
    }
  }

  async function generateBundle() {
    setGenerating(true);
    setResultError(null);
    setResult(null);

    try {
      const response = await fetch('/api/bundles/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundleTitle,
          bundleNotes,
          memberManifestPaths: selectedPaths,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setResult(data);
      } else {
        setResultError(data.error || (Array.isArray(data.errors) ? data.errors.join('\n') : 'Bundle generation failed'));
        setResult(data);
      }
    } catch {
      setResultError('Bundle generation failed');
    } finally {
      setGenerating(false);
    }
  }

  const displayedBundleId = result?.bundleId || result?.plan?.bundleId || 'n/a';

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
            Combine completed packages into a bundle package with its own manifest and ZIP.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
        >
          Back to Dashboard
        </Link>
      </div>

      {loadingError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {loadingError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]">
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-white">Bundle Title</label>
              <input
                value={bundleTitle}
                onChange={(event) => setBundleTitle(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                placeholder="Family Border Bundle"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-white">Optional Bundle Notes</label>
              <textarea
                value={bundleNotes}
                onChange={(event) => setBundleNotes(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                placeholder="Notes for internal reference or future template use"
              />
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Selected Members</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Selection order becomes bundle order. You can also paste a manifest path below.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={manualPath}
                  onChange={(event) => setManualPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addManualPath();
                    }
                  }}
                  className="w-72 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-950 dark:text-white"
                  placeholder="Paste manifest path"
                />
                <button
                  type="button"
                  onClick={addManualPath}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Add Path
                </button>
              </div>
            </div>

            {selectedSources.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                No member packages selected yet.
              </p>
            ) : (
              <div className="space-y-2">
                {selectedSources.map((entry, index) => {
                  const source = entry.source;
                  const displayTitle = source?.title || getLastPathSegment(entry.manifestPath);
                  const outputFolderPath = source?.outputFolderPath || null;
                  const packageId = source?.packageId || 'Unavailable';
                  const artworkId = source?.artworkId || 'Unavailable';
                  const profileId = source?.profileId || 'Unavailable';
                  const packageType = source?.packageType || '';

                  return (
                  <div
                    key={`${entry.manifestPath}-${index}`}
                    className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-950/60 lg:flex-row lg:items-start lg:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                          {displayTitle}
                        </p>
                        {packageType === 'bundle-package' ? (
                          <StatusPill tone="bad">Bundle package</StatusPill>
                        ) : source ? (
                          <StatusPill tone="good">Completed</StatusPill>
                        ) : (
                          <StatusPill tone="neutral">Manual path</StatusPill>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        Package: {packageId} · Artwork: {artworkId} · Profile: {profileId}
                      </p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={outputFolderPath || undefined}>
                        Output: {outputFolderPath || 'Unavailable'}
                      </p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={entry.manifestPath || undefined}>
                        Manifest: {entry.manifestPath || 'Unavailable'}
                      </p>
                      {source?.warnings.length ? (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Warning: {source.warnings.join(' · ')}
                        </p>
                      ) : null}
                      {source?.errors.length ? (
                        <p className="text-xs text-red-700 dark:text-red-300">
                          Error: {source.errors.join(' · ')}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveSelected(index, -1)}
                        disabled={index === 0}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSelected(index, 1)}
                        disabled={index === selectedSources.length - 1}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSelected(index)}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Completed Packages</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Click a thumbnail to select or deselect a package.
                </p>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-44 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                placeholder="Search"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredSources.map((source) => {
                const checked = Boolean(source.manifestPath && selectedPaths.includes(source.manifestPath));
                const selectedOrder = source.manifestPath ? selectedPaths.indexOf(source.manifestPath) + 1 : 0;
                const statusTone = source.packageType === 'bundle-package'
                  ? 'bad'
                  : source.readiness === true
                    ? 'good'
                    : source.readiness === false
                      ? 'warn'
                      : 'neutral';

                return (
                  <button
                    key={source.manifestPath || `${source.itemId}`}
                    type="button"
                    onClick={() => source.manifestPath && toggleSelected(source.manifestPath)}
                    className={`group flex flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 dark:bg-gray-900 ${
                      checked
                        ? 'border-blue-500 ring-2 ring-blue-500/30 dark:border-blue-400'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                    aria-pressed={checked}
                  >
                    <div className="relative">
                      <PackageThumbnail
                        src={source.thumbnailUrl}
                        path={source.thumbnailPath}
                        alt={source.title || source.baseName}
                        selected={checked}
                      />
                      {checked && (
                        <div className="absolute left-2 top-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                          Selected {selectedOrder}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                          {source.title || source.baseName}
                        </p>
                        <StatusPill tone={statusTone as 'good' | 'warn' | 'bad' | 'neutral'}>
                          {source.packageType === 'bundle-package'
                            ? 'Bundle'
                            : source.readiness === true
                              ? 'Ready'
                              : source.readiness === false
                                ? 'Not ready'
                                : 'Manual'}
                        </StatusPill>
                      </div>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{source.batchName || source.batchId}</p>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Pkg</div>
                          <div className="truncate">{source.packageId || 'n/a'}</div>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Art</div>
                          <div className="truncate">{source.artworkId || 'n/a'}</div>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Prof</div>
                          <div className="truncate">{source.profileId || 'n/a'}</div>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">Output</div>
                          <div className="truncate" title={source.outputFolderPath || undefined}>
                            {source.outputFolderPath || 'n/a'}
                          </div>
                        </div>
                      </div>
                      {source.warnings.length > 0 && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">Warning: {source.warnings.join(' · ')}</p>
                      )}
                      {source.errors.length > 0 && (
                        <p className="text-[11px] text-red-700 dark:text-red-300">Error: {source.errors.join(' · ')}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
            <button
              type="button"
              onClick={generateBundle}
              disabled={generating || !selectionValidation.canGenerate}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Generate Bundle
            </button>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Select at least 2 completed packages with manifest paths. Missing manifest or missing source files will fail generation.
            </p>

            <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-950/40 dark:text-gray-300">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="neutral">Selected: {selectedSources.length}</StatusPill>
                <StatusPill tone="good">Valid: {selectionValidation.validSelectedSources.length}</StatusPill>
                <StatusPill tone={selectionValidation.errors.length > 0 ? 'bad' : 'neutral'}>
                  Blocking: {selectionValidation.errors.length}
                </StatusPill>
                <StatusPill tone={selectionValidation.warnings.length > 0 ? 'warn' : 'neutral'}>
                  Warnings: {selectionValidation.warnings.length}
                </StatusPill>
              </div>

              {selectionValidation.errors.length > 0 && (
                <div className="mt-2 space-y-1 text-red-700 dark:text-red-300">
                  <p className="font-semibold">Fix before generating</p>
                  {selectionValidation.errors.map((error, index) => (
                    <p key={`${error}-${index}`}>{error}</p>
                  ))}
                </div>
              )}

              {!bundleTitle.trim() && (
                <p className="mt-2 text-amber-700 dark:text-amber-300">Enter a bundle title to enable generation.</p>
              )}

              {selectionValidation.errors.length === 0 && selectionValidation.validSelectedSources.length < 2 && (
                <p className="mt-2 text-amber-700 dark:text-amber-300">Select at least 2 completed packages.</p>
              )}

              {selectionValidation.warnings.length > 0 && selectionValidation.errors.length === 0 && (
                <div className="mt-2 space-y-1 text-amber-700 dark:text-amber-300">
                  <p className="font-semibold">Warnings</p>
                  {selectionValidation.warnings.map((warning, index) => (
                    <p key={`${warning}-${index}`}>{warning}</p>
                  ))}
                </div>
              )}
            </div>

            {resultError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                {resultError}
              </div>
            )}
          </div>

          {result && (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-700 dark:bg-gray-900/40">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {result.success ? 'Bundle Generated' : 'Bundle Result'}
                </h3>
                {result.success ? <StatusPill tone="good">Success</StatusPill> : <StatusPill tone="bad">Failed</StatusPill>}
              </div>

              <div className="space-y-1 text-gray-700 dark:text-gray-300">
                <p>Bundle ID: {displayedBundleId}</p>
                <p className="truncate" title={result.bundleFolderPath || undefined}>
                  Bundle Folder: {result.bundleFolderPath || 'n/a'}
                </p>
                <p className="truncate" title={result.manifestPath || undefined}>
                  Manifest: {result.manifestPath || 'n/a'}
                </p>
                <p className="truncate" title={result.zipPath || undefined}>
                  ZIP: {result.zipPath || 'n/a'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openBundleFolder}
                  disabled={!result.bundleFolderPath}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  <FolderOpen className="h-4 w-4" />
                  Open Bundle Folder
                </button>
                <button
                  type="button"
                  onClick={() => copyText(result.zipPath)}
                  disabled={!result.zipPath}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  <ClipboardCopy className="h-4 w-4" />
                  Copy Bundle ZIP Path
                </button>
                <button
                  type="button"
                  onClick={() => copyText(result.manifestPath)}
                  disabled={!result.manifestPath}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  <ClipboardCopy className="h-4 w-4" />
                  Copy Manifest Path
                </button>
              </div>

              {result.warnings && result.warnings.length > 0 && (
                <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="font-semibold">Warnings</p>
                  {result.warnings.map((warning, index) => (
                    <p key={`${warning}-${index}`}>{warning}</p>
                  ))}
                </div>
              )}

              {result.errors && result.errors.length > 0 && (
                <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
                  <p className="font-semibold">Errors</p>
                  {result.errors.map((error, index) => (
                    <p key={`${error}-${index}`}>{error}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
