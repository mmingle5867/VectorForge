'use client';

import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatBytes, formatDate } from '@/lib/utils';
import type { ListingMetadata } from '@/lib/package-manifest-schema';

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

interface OutputCompositeTemplateOption {
  id: string;
  name: string;
  description: string;
  assetProfile: string;
  marketplace: string;
  outputRole: string;
  slot: number | null;
  priority?: number | null;
  width?: number;
  height?: number;
  format?: string;
  quality?: number | null;
}

interface OutputListingMediaGeneratedItem {
  templateId: string;
  templateName: string;
  outputPath: string;
  metadata: {
    role: string;
    path: string;
    format: string;
    mimeType?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
    assetProfile: string;
    marketplace: string;
    templateId: string;
    slot: number | null;
  };
  warnings: string[];
}

interface OutputListingMediaSkippedItem {
  templateId: string;
  templateName: string;
  outputPath: string;
  reason: string;
  metadata?: OutputListingMediaGeneratedItem['metadata'] | null;
  warnings: string[];
}

interface OutputListingMediaResult {
  success: boolean;
  batchId: string;
  itemId: string;
  packageRoot: string | null;
  selectedTemplates: string[];
  generated: OutputListingMediaGeneratedItem[];
  skipped: OutputListingMediaSkippedItem[];
  warnings: string[];
  errors: string[];
  manifestUpdated?: boolean;
  manifestPath?: string | null;
}

interface ListingMetadataCompleteness {
  percentage: number;
  completeFields: number;
  totalFields: number;
  missingFields: string[];
}

interface PackageListingMetadataResponse {
  success: boolean;
  manifestPath?: string | null;
  schemaVersion?: string;
  canEdit?: boolean;
  listing?: ListingMetadata;
  completeness?: ListingMetadataCompleteness;
  warnings?: string[];
  error?: string;
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

function getPathDirectory(filePath: string) {
  return filePath.split(/[\\/]/).slice(0, -1).join('/');
}

function createEmptyListingMetadata(): ListingMetadata {
  return {
    title: '',
    shortTitle: '',
    description: '',
    shortDescription: '',
    bulletPoints: [],
    tags: [],
    keywords: [],
    category: '',
    subcategory: '',
    style: [],
    occasion: [],
    holiday: [],
    audience: [],
    suggestedPrice: null,
    currency: 'USD',
    notes: '',
  };
}

function parseDelimitedListInput(value: string) {
  return value
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, array) => array.indexOf(entry) === index);
}

function formatDelimitedList(items: string[]) {
  return items.join('\n');
}

function calculateCompleteness(listing: ListingMetadata) {
  const checks = [
    { label: 'Title', filled: Boolean(listing.title.trim()) },
    { label: 'Description', filled: Boolean(listing.description.trim()) },
    { label: 'Tags', filled: listing.tags.length > 0 },
    { label: 'Category', filled: Boolean(listing.category.trim()) },
    {
      label: 'Suggested Price',
      filled: listing.suggestedPrice !== null && listing.suggestedPrice !== undefined && !Number.isNaN(listing.suggestedPrice),
    },
  ];

  const missingFields = checks.filter((entry) => !entry.filled).map((entry) => entry.label);
  const completeFields = checks.length - missingFields.length;
  const percentage = Math.round((completeFields / checks.length) * 100);

  return { percentage, completeFields, totalFields: checks.length, missingFields };
}

function useCompositeTemplateCatalog() {
  const [templates, setTemplates] = useState<OutputCompositeTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      try {
        const res = await fetch('/api/composite-preview');
        const json = await res.json();

        if (!cancelled) {
          if (json.success) {
            setTemplates(Array.isArray(json.templates) ? json.templates : []);
            setError(null);
          } else {
            setTemplates([]);
            setError(json.error || 'Failed to load composite templates');
          }
        }
      } catch {
        if (!cancelled) {
          setTemplates([]);
          setError('Failed to load composite templates');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTemplates();

    return () => {
      cancelled = true;
    };
  }, []);

  return { templates, loading, error };
}

function ListingMediaSection({
  batchId,
  item,
  templates,
}: {
  batchId: string;
  item: OutputItem;
  templates: OutputCompositeTemplateOption[];
}) {
  const [marketplaceFilter, setMarketplaceFilter] = useState('');
  const [assetProfileFilter, setAssetProfileFilter] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OutputListingMediaResult | null>(null);

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      if (marketplaceFilter && template.marketplace !== marketplaceFilter) return false;
      if (assetProfileFilter && template.assetProfile !== assetProfileFilter) return false;
      return true;
    });
  }, [templates, marketplaceFilter, assetProfileFilter]);

  const marketplaceOptions = useMemo(
    () => Array.from(new Set(templates.map((template) => template.marketplace).filter(Boolean))).sort(),
    [templates]
  );
  const assetProfileOptions = useMemo(
    () => Array.from(new Set(templates.map((template) => template.assetProfile).filter(Boolean))).sort(),
    [templates]
  );
  const selectedTemplates = useMemo(
    () => selectedTemplateIds
      .map((templateId) => templates.find((template) => template.id === templateId))
      .filter((template): template is OutputCompositeTemplateOption => Boolean(template)),
    [selectedTemplateIds, templates]
  );

  const toggleTemplateSelection = (templateId: string) => {
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId]
    );
  };

  const selectVisibleTemplates = () => {
    setSelectedTemplateIds(filteredTemplates.map((template) => template.id));
  };

  const clearSelection = () => {
    setSelectedTemplateIds([]);
  };

  const copyPath = async (value: string | null | undefined) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Copied path to clipboard.');
    } catch {
      setMessage(`Path: ${value}`);
    }
  };

  const openFolder = async (folderPath: string | null | undefined) => {
    if (!folderPath) return;
    try {
      const res = await fetch('/api/local-editor/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'folder',
          outputFolderPath: folderPath,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Failed to open folder');
        return;
      }
      setMessage('Opened folder.');
    } catch {
      setError('Failed to open folder');
    }
  };

  const generate = async (mode: 'selected' | 'marketplace') => {
    const templateIds = mode === 'selected' ? selectedTemplateIds : [];
    const marketplace = mode === 'marketplace' ? marketplaceFilter : '';
    const assetProfile = mode === 'marketplace' ? assetProfileFilter : '';

    if (mode === 'selected' && templateIds.length === 0) {
      setError('Select at least one template before generating listing media.');
      return;
    }

    if (mode === 'marketplace' && !marketplace && !assetProfile) {
      setError('Choose a marketplace or asset profile filter before generating a set.');
      return;
    }

    setLoading(true);
    setError(null);
    setMessage('Generating listing media...');
    setResult(null);

    try {
      const res = await fetch('/api/listing-media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          itemId: item.id,
          templateIds,
          marketplace: marketplace || undefined,
          assetProfile: assetProfile || undefined,
          overwrite,
        }),
      });
      const json = await res.json();
      const nextResult = json as OutputListingMediaResult;
      setResult(nextResult);

      if (!res.ok || !json.success) {
        setError(
          json.error ||
            (Array.isArray(json.errors) && json.errors.length > 0
              ? json.errors.join(' ')
              : 'Listing media generation failed')
        );
        setMessage(null);
        return;
      }

      const generatedCount = Array.isArray(nextResult.generated) ? nextResult.generated.length : 0;
      const skippedCount = Array.isArray(nextResult.skipped) ? nextResult.skipped.length : 0;
      setMessage(
        `Generated ${generatedCount} image${generatedCount === 1 ? '' : 's'}${
          skippedCount ? `, skipped ${skippedCount}` : ''
        }.`
      );
    } catch {
      setError('Listing media generation failed');
      setMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const listingImagesFolder =
    result?.generated[0]?.outputPath && item.outputFolderPath
      ? `${item.outputFolderPath}/${getPathDirectory(result.generated[0].outputPath)}`
      : null;

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Listing Media / Composites</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Generate and manage composite listing images for this completed package.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openFolder(item.outputFolderPath)}
            disabled={!item.outputFolderPath}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Open Output Folder
          </button>
          <button
            type="button"
            onClick={() => openFolder(listingImagesFolder)}
            disabled={!listingImagesFolder}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Open Listing Images
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Marketplace
          <select
            value={marketplaceFilter}
            onChange={(event) => setMarketplaceFilter(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">All marketplaces</option>
            {marketplaceOptions.map((marketplace) => (
              <option key={marketplace} value={marketplace}>
                {marketplace}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Asset Profile
          <select
            value={assetProfileFilter}
            onChange={(event) => setAssetProfileFilter(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">All profiles</option>
            {assetProfileOptions.map((profile) => (
              <option key={profile} value={profile}>
                {profile}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
          />
          Overwrite existing
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={selectVisibleTemplates}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Select Visible
        </button>
        <button
          type="button"
          onClick={clearSelection}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => generate('selected')}
          disabled={loading || selectedTemplateIds.length === 0}
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Generating...' : 'Generate Selected'}
        </button>
        <button
          type="button"
          onClick={() => generate('marketplace')}
          disabled={loading || (!marketplaceFilter && !assetProfileFilter)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Generate Marketplace Set
        </button>
      </div>

      <div className="mt-3 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {templates.length === 0 ? (
          <div className="p-3 text-center text-xs text-gray-500 dark:text-gray-400">
            No composite templates available.
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="p-3 text-center text-xs text-gray-500 dark:text-gray-400">
            No templates match the current filters.
          </div>
        ) : (
          <table className="w-full divide-y divide-gray-200 text-left text-[11px] dark:divide-gray-700">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-2 py-1.5">Use</th>
                <th className="px-2 py-1.5">Template</th>
                <th className="px-2 py-1.5">Profile</th>
                <th className="px-2 py-1.5">Market</th>
                <th className="px-2 py-1.5">Slot</th>
                <th className="px-2 py-1.5">Format</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredTemplates.map((template) => {
                const checked = selectedTemplateIds.includes(template.id);
                return (
                  <tr key={template.id} className={checked ? 'bg-blue-50/70 dark:bg-blue-900/20' : ''}>
                    <td className="px-2 py-1.5 align-top">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTemplateSelection(template.id)}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{template.name}</div>
                        <div className="text-gray-500 dark:text-gray-400">{template.id}</div>
                        <div className="text-gray-400 dark:text-gray-500">
                          {template.width && template.height ? `${template.width} x ${template.height}` : 'Size unavailable'}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top text-gray-700 dark:text-gray-300">{template.assetProfile}</td>
                    <td className="px-2 py-1.5 align-top text-gray-700 dark:text-gray-300">{template.marketplace}</td>
                    <td className="px-2 py-1.5 align-top text-gray-700 dark:text-gray-300">{template.slot ?? 'n/a'}</td>
                    <td className="px-2 py-1.5 align-top text-gray-700 dark:text-gray-300">{template.format || 'n/a'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-3 grid gap-2 rounded-md border border-gray-200 bg-white p-3 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 sm:grid-cols-3">
        <div><span className="font-medium">Selected:</span> {selectedTemplateIds.length}</div>
        <div><span className="font-medium">Marketplace:</span> {marketplaceFilter || 'all'}</div>
        <div><span className="font-medium">Asset Profile:</span> {assetProfileFilter || 'all'}</div>
      </div>

      {message && (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 sm:grid-cols-3">
            <div><span className="font-medium">Generated:</span> {result.generated.length}</div>
            <div><span className="font-medium">Skipped:</span> {result.skipped.length}</div>
            <div><span className="font-medium">Selected:</span> {result.selectedTemplates.length}</div>
            <div><span className="font-medium">Manifest updated:</span> {result.manifestUpdated ? 'yes' : 'no'}</div>
            <div className="break-all sm:col-span-2">
              <span className="font-medium">Manifest path:</span> {result.manifestPath || 'n/a'}
            </div>
          </div>

          {result.generated.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">
                Generated
              </p>
              {result.generated.map((entry) => (
                <div key={`${entry.templateId}-${entry.outputPath}`} className="space-y-2 rounded-md border border-green-200 bg-green-50 p-2 text-[11px] text-green-900 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">
                      {entry.templateName} <span className="font-normal">({entry.templateId})</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => copyPath(entry.outputPath)}
                        className="rounded-md border border-green-300 bg-white px-2 py-1 text-[11px] font-medium text-green-800 hover:bg-green-100 dark:border-green-800 dark:bg-gray-900 dark:text-green-200 dark:hover:bg-green-900/50"
                      >
                        Copy Path
                      </button>
                      <button
                        type="button"
                        onClick={() => openFolder(getPathDirectory(entry.outputPath))}
                        className="rounded-md border border-green-300 bg-white px-2 py-1 text-[11px] font-medium text-green-800 hover:bg-green-100 dark:border-green-800 dark:bg-gray-900 dark:text-green-200 dark:hover:bg-green-900/50"
                      >
                        Open Folder
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[140px,1fr]">
                    <div className="overflow-hidden rounded-md border border-green-200 bg-white dark:border-green-900/40 dark:bg-gray-950">
                      <img
                        src={`/api/composite-preview?mode=image&batchId=${encodeURIComponent(batchId)}&itemId=${encodeURIComponent(item.id)}&path=${encodeURIComponent(entry.outputPath)}`}
                        alt={entry.templateName}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="break-all text-green-800 dark:text-green-100">{entry.outputPath}</div>
                      <div className="grid grid-cols-2 gap-1 text-green-800 dark:text-green-100">
                        <div><span className="font-medium">Role:</span> {entry.metadata.role}</div>
                        <div><span className="font-medium">Market:</span> {entry.metadata.marketplace}</div>
                        <div><span className="font-medium">Profile:</span> {entry.metadata.assetProfile}</div>
                        <div><span className="font-medium">Slot:</span> {entry.metadata.slot ?? 'n/a'}</div>
                        <div><span className="font-medium">Format:</span> {entry.metadata.format}</div>
                        <div><span className="font-medium">Size:</span> {entry.metadata.width} x {entry.metadata.height}</div>
                      </div>
                    </div>
                  </div>
                  {entry.warnings.length > 0 && (
                    <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
                      {entry.warnings.map((warning, index) => (
                        <div key={`${warning}-${index}`}>{warning}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.skipped.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Skipped
              </p>
              {result.skipped.map((entry) => (
                <div key={`${entry.templateId}-${entry.outputPath}`} className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">
                      {entry.templateName} <span className="font-normal">({entry.templateId})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyPath(entry.outputPath)}
                      className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-200 dark:hover:bg-amber-900/50"
                    >
                      Copy Path
                    </button>
                  </div>
                  <div className="break-all text-amber-800 dark:text-amber-100">{entry.outputPath}</div>
                  <div>{entry.reason}</div>
                </div>
              ))}
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
              <p className="font-semibold">Warnings</p>
              {result.warnings.map((warning, index) => (
                <div key={`${warning}-${index}`}>{warning}</div>
              ))}
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">
              <p className="font-semibold">Errors</p>
              {result.errors.map((failure, index) => (
                <div key={`${failure}-${index}`}>{failure}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PackageListingMetadataSection({
  batchId,
  item,
}: {
  batchId: string;
  item: OutputItem;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manifestPath, setManifestPath] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [listing, setListing] = useState<ListingMetadata>(createEmptyListingMetadata());
  const [completeness, setCompleteness] = useState<ListingMetadataCompleteness>(
    calculateCompleteness(createEmptyListingMetadata())
  );

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      if (!item.outputFolderPath) {
        setLoading(false);
        setCanEdit(false);
        setError('Package output folder is missing.');
        return;
      }

      try {
        const res = await fetch(
          `/api/packages/metadata?batchId=${encodeURIComponent(batchId)}&itemId=${encodeURIComponent(item.id)}`
        );
        const json = (await res.json()) as PackageListingMetadataResponse;

        if (!cancelled) {
          if (res.ok && json.success) {
            setListing(json.listing || createEmptyListingMetadata());
            setCompleteness(json.completeness || calculateCompleteness(json.listing || createEmptyListingMetadata()));
            setManifestPath(json.manifestPath || null);
            setCanEdit(Boolean(json.canEdit));
            setWarnings(Array.isArray(json.warnings) ? json.warnings : []);
            setError(null);
          } else {
            setCanEdit(false);
            setError(json.error || 'Failed to load listing metadata');
            setWarnings(Array.isArray(json.warnings) ? json.warnings : []);
          }
        }
      } catch {
        if (!cancelled) {
          setCanEdit(false);
          setError('Failed to load listing metadata');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [batchId, item.id, item.outputFolderPath]);

  const updateField = (field: keyof ListingMetadata, value: string | number | null | string[]) => {
    setListing((current) => ({ ...current, [field]: value } as ListingMetadata));
  };

  const updateArrayField = (field: keyof Pick<ListingMetadata, 'bulletPoints' | 'tags' | 'keywords' | 'style' | 'occasion' | 'holiday' | 'audience'>, value: string) => {
    updateField(field, parseDelimitedListInput(value));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage('Saving listing metadata...');

    try {
      const res = await fetch('/api/packages/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          itemId: item.id,
          listing,
        }),
      });
      const json = (await res.json()) as PackageListingMetadataResponse;

      if (!res.ok || !json.success) {
        setError(json.error || 'Failed to save listing metadata');
        setWarnings(Array.isArray(json.warnings) ? json.warnings : []);
        setMessage(null);
        return;
      }

      setListing(json.listing || createEmptyListingMetadata());
      setCompleteness(json.completeness || calculateCompleteness(json.listing || createEmptyListingMetadata()));
      setManifestPath(json.manifestPath || null);
      setCanEdit(Boolean(json.canEdit));
      setWarnings(Array.isArray(json.warnings) ? json.warnings : []);
      setMessage('Listing metadata saved.');
    } catch {
      setError('Failed to save listing metadata');
      setMessage(null);
    } finally {
      setSaving(false);
    }
  };

  const completenessNow = calculateCompleteness(listing);
  const displayCompleteness = completenessNow.missingFields.length > 0 ? completenessNow : completeness;

  if (loading) {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
        <div className="text-xs text-gray-500 dark:text-gray-400">Loading listing metadata...</div>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Metadata / Listing Metadata</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Generic, platform-neutral product metadata stored in the manifest.
          </p>
        </div>
        <div className="text-right text-[11px] text-gray-600 dark:text-gray-300">
          <div>
            <span className="font-medium">Completeness:</span> {displayCompleteness.percentage}%
          </div>
          <div>
            <span className="font-medium">Manifest:</span> {manifestPath || 'n/a'}
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
          This manifest cannot be edited yet because it is not Manifest V2.
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Title
          <input
            value={listing.title}
            onChange={(event) => updateField('title', event.target.value)}
            disabled={!canEdit}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Short Title
          <input
            value={listing.shortTitle}
            onChange={(event) => updateField('shortTitle', event.target.value)}
            disabled={!canEdit}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
          Description
          <textarea
            value={listing.description}
            onChange={(event) => updateField('description', event.target.value)}
            disabled={!canEdit}
            rows={4}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
          Short Description
          <textarea
            value={listing.shortDescription}
            onChange={(event) => updateField('shortDescription', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Category
          <input
            value={listing.category}
            onChange={(event) => updateField('category', event.target.value)}
            disabled={!canEdit}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Subcategory
          <input
            value={listing.subcategory}
            onChange={(event) => updateField('subcategory', event.target.value)}
            disabled={!canEdit}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Suggested Price
          <input
            type="number"
            step="0.01"
            value={listing.suggestedPrice ?? ''}
            onChange={(event) => updateField('suggestedPrice', event.target.value ? Number(event.target.value) : null)}
            disabled={!canEdit}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Currency
          <input
            value={listing.currency}
            onChange={(event) => updateField('currency', event.target.value)}
            disabled={!canEdit}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Bullet Points
          <textarea
            value={formatDelimitedList(listing.bulletPoints)}
            onChange={(event) => updateArrayField('bulletPoints', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Tags
          <textarea
            value={formatDelimitedList(listing.tags)}
            onChange={(event) => updateArrayField('tags', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Keywords
          <textarea
            value={formatDelimitedList(listing.keywords)}
            onChange={(event) => updateArrayField('keywords', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Style
          <textarea
            value={formatDelimitedList(listing.style)}
            onChange={(event) => updateArrayField('style', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Occasion
          <textarea
            value={formatDelimitedList(listing.occasion)}
            onChange={(event) => updateArrayField('occasion', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Holiday
          <textarea
            value={formatDelimitedList(listing.holiday)}
            onChange={(event) => updateArrayField('holiday', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          Audience
          <textarea
            value={formatDelimitedList(listing.audience)}
            onChange={(event) => updateArrayField('audience', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
          Notes
          <textarea
            value={listing.notes}
            onChange={(event) => updateField('notes', event.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-2 rounded-md border border-gray-200 bg-white p-3 text-[11px] text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 sm:grid-cols-3">
        <div>
          <span className="font-medium">Complete:</span> {completenessNow.percentage}%
        </div>
        <div>
          <span className="font-medium">Required fields:</span> {completenessNow.completeFields}/{completenessNow.totalFields}
        </div>
        <div className="sm:col-span-1">
          <span className="font-medium">Missing:</span>{' '}
          {completenessNow.missingFields.length > 0 ? completenessNow.missingFields.join(', ') : 'none'}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !canEdit}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Metadata'}
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
          {warnings.map((warning, index) => (
            <div key={`${warning}-${index}`}>{warning}</div>
          ))}
        </div>
      )}
      {message && (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-100">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">
          {error}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Output Page
// ============================================================================

export default function OutputPage() {
  const params = useParams();
  const batchId = params.batchId as string;

  const { templates: compositeTemplates, loading: templatesLoading, error: templatesError } = useCompositeTemplateCatalog();
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

  const openOutputFolder = async (folderPath: string | null | undefined) => {
    if (!folderPath) return;

    try {
      const res = await fetch('/api/local-editor/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'folder',
          outputFolderPath: folderPath,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Failed to open folder');
      }
    } catch {
      setError('Failed to open folder');
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

      {templatesError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {templatesError}
        </div>
      )}

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

                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.outputFolderPath && (
                      <button
                        type="button"
                        onClick={() => openOutputFolder(item.outputFolderPath)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                      >
                        Open Output Folder
                      </button>
                    )}
                    {(item.status === 'READY_TO_PROCESS' || item.status === 'NEEDS_MANUAL_EDIT' || item.status === 'COMPLETED') && (
                      <Link
                        href={`/upload/review/${batchId}?itemId=${item.id}`}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                      >
                        Reopen Preview/Tune
                      </Link>
                    )}
                  </div>

                  {item.outputFolderPath && (
                    <PackageListingMetadataSection batchId={batchId} item={item} />
                  )}

                  <ListingMediaSection
                    batchId={batchId}
                    item={item}
                    templates={templatesLoading ? [] : compositeTemplates}
                  />

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
