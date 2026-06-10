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

interface TuneSettings {
  preUpscaleBlur: number;
  blur: number;
  blurPasses: number;
  pathPrecision: number;
  cornerThreshold: number;
  filterSpeckle: number;
  lengthThreshold: number;
  spliceThreshold: number;
  colorPrecision: number;
  layerDifference: number;
}

interface TunePreview {
  svgBase64: string;
  svgSize: number;
  debugSvgPath?: string;
  diagnostics: {
    svgLength: number;
    pathCount: number;
    rootSvgTag: string;
    viewBox: string;
    width: string;
    height: string;
    firstPathTag: string;
    fillNoneCount: number;
    strokeCount: number;
    opacityZeroCount: number;
    hasVisibleFill: boolean;
    hasVisibleStroke: boolean;
  };
  originalWidth: number;
  originalHeight: number;
  traceWidth: number;
  traceHeight: number;
  upscaleApplied: boolean;
  upscaleFactor: number;
  processingTimeMs: number;
}

type PreviewStatus = 'idle' | 'loading' | 'success' | 'error';

const DEFAULT_TUNE_SETTINGS: TuneSettings = {
  preUpscaleBlur: 0,
  blur: 1.0,
  blurPasses: 1,
  pathPrecision: 3,
  cornerThreshold: 70,
  filterSpeckle: 6,
  lengthThreshold: 4,
  spliceThreshold: 45,
  colorPrecision: 6,
  layerDifference: 16,
};

const TUNE_CONTROLS: Array<{
  key: keyof TuneSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
}> = [
  {
    key: 'preUpscaleBlur',
    label: 'Pre-Upscale Blur',
    min: 0,
    max: 5,
    step: 0.1,
    help: 'Applies light blur before upscaling. Recommended 0-0.75 for testing edge smoothing.',
  },
  {
    key: 'blur',
    label: 'Preprocessing Blur',
    min: 0,
    max: 20,
    step: 0.1,
    help: 'Smooths raster edges before tracing. Try 0.75-2.0; stronger values can help difficult jagged images.',
  },
  {
    key: 'blurPasses',
    label: 'Blur Passes',
    min: 1,
    max: 3,
    step: 1,
    help: 'Repeats the same blur before border padding. Use 1 normally; 2-3 for difficult stair-stepping.',
  },
  {
    key: 'pathPrecision',
    label: 'Path Precision',
    min: 0,
    max: 8,
    step: 1,
    help: 'Decimal precision for SVG paths. Higher preserves smoother coordinates.',
  },
  {
    key: 'cornerThreshold',
    label: 'Corner Threshold',
    min: 30,
    max: 90,
    step: 5,
    help: 'Higher detects fewer hard corners and rounds more curves.',
  },
  {
    key: 'filterSpeckle',
    label: 'Filter Speckle',
    min: 0,
    max: 20,
    step: 1,
    help: 'Removes small noisy shapes. Higher is cleaner but may remove small details.',
  },
  {
    key: 'lengthThreshold',
    label: 'Length Threshold',
    min: 3.5,
    max: 10,
    step: 0.5,
    help: 'Minimum path segment length. Higher simplifies paths and can reduce jagged detail.',
  },
  {
    key: 'spliceThreshold',
    label: 'Splice Threshold',
    min: 20,
    max: 125,
    step: 5,
    help: 'Controls path merging. Higher creates fewer paths but can lose detail.',
  },
  {
    key: 'colorPrecision',
    label: 'Color Precision',
    min: 1,
    max: 8,
    step: 1,
    help: 'Controls color detail retained before tracing. Use 6 for most designs.',
  },
  {
    key: 'layerDifference',
    label: 'Layer Difference',
    min: 0,
    max: 64,
    step: 1,
    help: 'Controls color/gradient layer separation. Higher can create smoother tonal steps.',
  },
];

const PREVIEW_STATUS_STYLES: Record<PreviewStatus, string> = {
  idle: 'border-gray-200 bg-gray-50 text-gray-900',
  loading: 'border-gray-200 bg-gray-100 text-gray-900',
  success: 'border-green-200 bg-green-50 text-green-900',
  error: 'border-red-200 bg-red-50 text-red-900',
};

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
  const [tuneItem, setTuneItem] = useState<BatchItem | null>(null);
  const [tuneSettings, setTuneSettings] = useState<TuneSettings>(DEFAULT_TUNE_SETTINGS);
  const [tunePreview, setTunePreview] = useState<TunePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewStatusMessage, setPreviewStatusMessage] = useState<string | null>(null);
  const [svgZoom, setSvgZoom] = useState(1);

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

  const openTunePanel = (item: BatchItem) => {
    setTuneItem(item);
    setTuneSettings(DEFAULT_TUNE_SETTINGS);
    setTunePreview(null);
    setPreviewError(null);
    setPreviewStatus('idle');
    setPreviewStatusMessage(null);
    setSvgZoom(1);
  };

  const updateTuneSetting = (key: keyof TuneSettings, value: number) => {
    setTuneSettings((prev) => ({ ...prev, [key]: value }));
  };

  const previewSvgDataUrl = tunePreview
    ? `data:image/svg+xml;base64,${tunePreview.svgBase64}`
    : '';

  const generatePreview = async () => {
    if (!tuneItem) return;

    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewStatus('loading');
    setPreviewStatusMessage('Generating preview...');

    try {
      const res = await fetch(
        `/api/batches/${batchId}/items/${tuneItem.id}/preview-tune`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tuneSettings),
        }
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        const message =
          data.message ||
          data.error ||
          (data.field && data.allowedRange
            ? `${data.field} must be between ${data.allowedRange}`
            : 'Failed to generate preview');
        setPreviewError(message);
        setPreviewStatus('error');
        setPreviewStatusMessage(message.startsWith('Preview failed') ? message : `Preview failed: ${message}`);
        return;
      }

      setTunePreview(data.preview);
      setPreviewStatus('success');
      setPreviewStatusMessage('Preview generated successfully');
      setSvgZoom(1);
    } catch {
      const message = 'Failed to generate preview';
      setPreviewError(message);
      setPreviewStatus('error');
      setPreviewStatusMessage(`Preview failed: ${message}`);
    } finally {
      setPreviewLoading(false);
    }
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

              <button
                onClick={() => openTunePanel(item)}
                className="w-full rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                Preview/Tune
              </button>
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

      {tuneItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Preview/Tune</h2>
                <p className="text-sm text-gray-500">{tuneItem.originalFilename}</p>
              </div>
              <button
                onClick={() => setTuneItem(null)}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>

            <div className="max-h-[calc(92vh-73px)] overflow-y-auto">
              <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800">Original</h3>
                    {tuneItem.originalWidth && tuneItem.originalHeight && (
                      <span className="text-xs text-gray-500">
                        {tuneItem.originalWidth} x {tuneItem.originalHeight}px
                      </span>
                    )}
                  </div>
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    <img
                      src={tuneItem.previewUrl}
                      alt={tuneItem.originalFilename}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setTuneSettings(DEFAULT_TUNE_SETTINGS)}
                      className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Restore Defaults
                    </button>
                    <button
                      onClick={generatePreview}
                      disabled={previewLoading}
                      className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      {previewLoading ? 'Generating...' : 'Generate Preview'}
                    </button>
                  </div>
                </div>

                <div className="flex max-h-[476px] flex-col overflow-hidden rounded-lg border border-gray-200">
                  <div className={`border-b px-4 py-3 ${PREVIEW_STATUS_STYLES[previewStatus]}`}>
                    <h3 className="text-sm font-semibold">Temporary Settings</h3>
                    {previewStatusMessage && (
                      <p className="mt-1 text-xs leading-4">{previewStatusMessage}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-x-5 gap-y-4 overflow-y-auto p-4 md:grid-cols-2">
                    {TUNE_CONTROLS.map((control) => (
                      <div key={control.key} className="space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <label className="text-xs font-medium text-gray-700">
                              {control.label}
                            </label>
                            <p className="mt-0.5 text-[11px] leading-4 text-gray-500">
                              {control.help}
                            </p>
                          </div>
                          <input
                            type="number"
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={tuneSettings[control.key]}
                            onChange={(e) =>
                              updateTuneSetting(control.key, Number(e.target.value))
                            }
                            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <input
                          type="range"
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          value={tuneSettings[control.key]}
                          onChange={(e) =>
                            updateTuneSetting(control.key, Number(e.target.value))
                          }
                          className="w-full accent-blue-600"
                        />
                        <div className="flex justify-between text-[10px] text-gray-400">
                          <span>{control.min}</span>
                          <span>{control.max}</span>
                        </div>
                      </div>
                    ))}

                    {previewError && (
                      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 md:col-span-2">
                        {previewError}
                      </div>
                    )}

                    <p className="text-xs leading-5 text-gray-500 md:col-span-2">
                      These settings are temporary for visual testing only. Nothing is saved or queued.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">SVG Preview</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={previewSvgDataUrl}
                      download={tuneItem ? `${tuneItem.baseName || tuneItem.id}-preview.svg` : 'preview.svg'}
                      className={`rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${
                        tunePreview ? '' : 'pointer-events-none opacity-50'
                      }`}
                    >
                      Download Preview SVG
                    </a>
                    <button
                      onClick={() => setSvgZoom((prev) => Math.max(0.25, Number((prev - 0.25).toFixed(2))))}
                      disabled={!tunePreview}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Zoom Out
                    </button>
                    <span className="w-14 text-center text-xs font-medium text-gray-600">
                      {Math.round(svgZoom * 100)}%
                    </span>
                    <button
                      onClick={() => setSvgZoom((prev) => Math.min(6, Number((prev + 0.25).toFixed(2))))}
                      disabled={!tunePreview}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Zoom In
                    </button>
                    <button
                      onClick={() => setSvgZoom(1)}
                      disabled={!tunePreview}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Reset Zoom
                    </button>
                  </div>
                </div>

                <div
                  className="h-[58vh] min-h-[480px] overflow-auto rounded-lg border border-gray-200"
                  style={{
                    backgroundColor: '#f8fafc',
                    backgroundImage:
                      'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                    backgroundSize: '24px 24px',
                    backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
                  }}
                >
                  <div className="flex min-h-full min-w-full items-center justify-center p-8">
                    {previewLoading ? (
                      <div className="rounded-md bg-white/90 px-4 py-3 text-sm text-gray-600 shadow-sm">
                        Generating preview...
                      </div>
                    ) : tunePreview ? (
                      <img
                        src={previewSvgDataUrl}
                        alt="Generated SVG preview"
                        style={{
                          width: tunePreview.traceWidth * svgZoom,
                          height: tunePreview.traceHeight * svgZoom,
                          maxWidth: 'none',
                        }}
                      />
                    ) : (
                      <div className="rounded-md bg-white/90 px-6 py-4 text-center text-sm text-gray-500 shadow-sm">
                        Adjust settings, then generate a preview for this item.
                      </div>
                    )}
                  </div>
                </div>

                {tunePreview && (
                  <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="mb-3 text-xs text-gray-500">
                      {formatBytes(tunePreview.svgSize)} - {tunePreview.processingTimeMs}ms - traced at{' '}
                      {tunePreview.traceWidth} x {tunePreview.traceHeight}px
                      {tunePreview.upscaleApplied
                        ? ` after ${tunePreview.upscaleFactor}x smart upscale`
                        : ' without smart upscale'}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-700 md:grid-cols-4">
                      <div>
                        <span className="font-medium">SVG length:</span>{' '}
                        {tunePreview.diagnostics.svgLength}
                      </div>
                      <div>
                        <span className="font-medium">Paths:</span>{' '}
                        {tunePreview.diagnostics.pathCount}
                      </div>
                      <div>
                        <span className="font-medium">fill none:</span>{' '}
                        {tunePreview.diagnostics.fillNoneCount}
                      </div>
                      <div>
                        <span className="font-medium">stroke:</span>{' '}
                        {tunePreview.diagnostics.strokeCount}
                      </div>
                      <div>
                        <span className="font-medium">opacity 0:</span>{' '}
                        {tunePreview.diagnostics.opacityZeroCount}
                      </div>
                      <div>
                        <span className="font-medium">visible fill:</span>{' '}
                        {tunePreview.diagnostics.hasVisibleFill ? 'yes' : 'no'}
                      </div>
                      <div>
                        <span className="font-medium">visible stroke:</span>{' '}
                        {tunePreview.diagnostics.hasVisibleStroke ? 'yes' : 'no'}
                      </div>
                      <div>
                        <span className="font-medium">debug file:</span>{' '}
                        {tunePreview.debugSvgPath || 'not saved'}
                      </div>
                      <div>
                        <span className="font-medium">viewBox:</span>{' '}
                        {tunePreview.diagnostics.viewBox || 'none'}
                      </div>
                      <div>
                        <span className="font-medium">width:</span>{' '}
                        {tunePreview.diagnostics.width || 'none'}
                      </div>
                      <div>
                        <span className="font-medium">height:</span>{' '}
                        {tunePreview.diagnostics.height || 'none'}
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      <div>
                        <p className="mb-1 text-xs font-medium text-gray-700">Root SVG tag</p>
                        <pre className="max-h-20 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700">
                          {tunePreview.diagnostics.rootSvgTag || 'none'}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-gray-700">First path tag</p>
                        <pre className="max-h-24 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700">
                          {tunePreview.diagnostics.firstPathTag || 'none'}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
