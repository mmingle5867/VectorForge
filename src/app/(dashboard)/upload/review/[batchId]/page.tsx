'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { formatBytes } from '@/lib/utils';
import SubstitutionTable, {
  type SubstitutionRow,
  objectToRows,
  rowsToObject,
} from '@/components/substitution-table';

interface BatchItem {
  id: string;
  originalFilename: string;
  baseName: string;
  sequenceNumber: number;
  mimeType: string;
  originalWidth: number | null;
  originalHeight: number | null;
  originalSize: number | null;
  upscaleFactor: number;
  status: string;
  previewUrl: string;
}

interface BatchInfo {
  id: string;
  status: string;
  totalItems: number;
  upscaleFactor: number;
  smartUpscaleThreshold: number;
}

export default function ReviewPage() {
  const router = useRouter();
  const params = useParams();
  const batchId = params.batchId as string;

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalUpscale, setGlobalUpscale] = useState<number>(2);
  const [substitutions, setSubstitutions] = useState<SubstitutionRow[]>([]);

  // Fetch batch items
  useEffect(() => {
    async function fetchBatch() {
      try {
        const res = await fetch(`/api/batches/${batchId}/items`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          setError(data.error || 'Failed to load batch');
          return;
        }

        setBatch(data.batch);
        setItems(data.items);
        setGlobalUpscale(data.batch.upscaleFactor);
      } catch {
        setError('Failed to load batch data');
      } finally {
        setLoading(false);
      }
    }

    fetchBatch();
  }, [batchId]);

  // Update item base name
  const updateBaseName = (itemId: string, newName: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, baseName: newName.replace(/[^a-zA-Z0-9_-]/g, '_') }
          : item
      )
    );
  };

  // Update item upscale factor
  const updateItemUpscale = (itemId: string, factor: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, upscaleFactor: factor } : item
      )
    );
  };

  // Apply global upscale to all items
  const applyGlobalUpscale = () => {
    setItems((prev) =>
      prev.map((item) => ({ ...item, upscaleFactor: globalUpscale }))
    );
  };

  // Save changes
  const saveChanges = async () => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/batches/${batchId}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            baseName: item.baseName,
            upscaleFactor: item.upscaleFactor,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to save changes');
      }
    } catch {
      setError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // Start conversion
  const startConversion = async () => {
    setConverting(true);
    setError(null);

    // Save changes first
    await saveChanges();

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to start conversion');
        setConverting(false);
        return;
      }

      // Navigate to batch progress page
      router.push(`/processing/${batchId}`);
    } catch {
      setError('Failed to start conversion');
      setConverting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <svg className="mx-auto h-8 w-8 animate-spin text-blue-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="mt-3 text-sm text-gray-600">Loading batch...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pre-Conversion Review</h1>
          <p className="mt-1 text-sm text-gray-600">
            Review and edit base names, set upscale factors before conversion.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveChanges}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={startConversion}
            disabled={converting}
            className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {converting ? 'Starting...' : 'Start Conversion'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Global Upscale Control */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">Global Upscale Factor:</span>
          <select
            value={globalUpscale}
            onChange={(e) => setGlobalUpscale(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value={1}>1x (No upscale)</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
          <button
            onClick={applyGlobalUpscale}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Apply to All
          </button>
          {batch && (
            <span className="ml-auto text-xs text-gray-500">
              Smart threshold: {batch.smartUpscaleThreshold}px - {batch.totalItems} items
            </span>
          )}
        </div>
      </div>

      {/* Items Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm"
          >
            {/* Image Preview */}
            <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
              <img
                src={item.previewUrl}
                alt={item.originalFilename}
                className="h-full w-full object-contain"
                loading="lazy"
              />
            </div>

            {/* Item Details */}
            <div className="p-3 space-y-3">
              {/* Original filename */}
              <div>
                <p className="truncate text-xs text-gray-500" title={item.originalFilename}>
                  {item.originalFilename}
                </p>
                {item.originalWidth && item.originalHeight && (
                  <p className="text-xs text-gray-400">
                    {item.originalWidth} x {item.originalHeight}px -{' '}
                    {item.originalSize ? formatBytes(item.originalSize) : ''}
                  </p>
                )}
              </div>

              {/* Base Name Input */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Base Name
                </label>
                <input
                  type="text"
                  value={item.baseName}
                  onChange={(e) => updateBaseName(item.id, e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Enter base name"
                />
              </div>

              {/* Upscale Factor */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Upscale Factor
                </label>
                <select
                  value={item.upscaleFactor}
                  onChange={(e) => updateItemUpscale(item.id, Number(e.target.value))}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value={1}>1x (No upscale)</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Per-Batch Substitution Variables */}
      {items.length > 0 && (
        <div className="mt-8">
          <SubstitutionTable
            rows={substitutions}
            onChange={setSubstitutions}
            showPlaceholders={true}
            maxRows={30}
            compact={true}
          />
        </div>
      )}

      {/* Bottom Action Bar */}
      {items.length > 0 && (
        <div className="mt-8 flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">
            {items.length} image{items.length > 1 ? 's' : ''} ready for conversion
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/upload')}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Back to Upload
            </button>
            <button
              onClick={startConversion}
              disabled={converting}
              className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {converting ? 'Starting...' : 'Start Conversion'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
