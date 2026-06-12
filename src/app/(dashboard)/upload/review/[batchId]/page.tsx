'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { formatBytes } from '@/lib/utils';
import SubstitutionTable, {
  type SubstitutionRow,
  objectToRows,
  rowsToObject,
} from '@/components/substitution-table';
import {
  FACTORY_TUNING_EXPORT_DEFAULTS,
  type TuningExportSettings,
} from '@/lib/tuning-defaults';

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
  outputFolderPath: string | null;
  zipPath: string | null;
  files?: Record<'svg' | 'png' | 'jpg', { exists: boolean; path: string | null }>;
  previewUrl: string;
}

interface BatchInfo {
  id: string;
  status: string;
  statusLabel?: string;
  statusCounts?: Record<string, number>;
  totalItems: number;
  upscaleFactor: number;
  smartUpscaleThreshold: number;
}

interface TuneSettings {
  colorMode: 'color' | 'binary';
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

interface SavedOutputFile {
  type: string;
  filename: string;
  path: string;
  size: number;
}

type PreviewStatus = 'idle' | 'loading' | 'success' | 'error';
type SaveStatus = 'idle' | 'saving' | 'success' | 'error';
type ManualEditAction = 'needs_manual_edit' | 'ready_to_process';

function getStatusMessage(
  status: string | undefined,
  pendingCount: number,
  manualCount: number,
  readyCount: number,
  completedCount: number
) {
  if (!status) return null;
  if (pendingCount > 0) {
    return `${pendingCount} item${pendingCount === 1 ? '' : 's'} still need review before conversion.`;
  }
  if (manualCount > 0) {
    return `${manualCount} item${manualCount === 1 ? '' : 's'} need manual editing before final completion.`;
  }
  if (readyCount > 0 && status === 'READY_TO_PROCESS') {
    return `${readyCount} item${readyCount === 1 ? ' is' : 's are'} ready for final package generation.`;
  }
  if (status === 'COMPLETED') {
    return `${completedCount} item${completedCount === 1 ? '' : 's'} completed.`;
  }
  if (status === 'PROCESSING') {
    return 'This batch is already processing. Start Conversion is unavailable.';
  }
  if (status === 'FAILED') {
    return 'This batch has failed items. Use the dashboard retry actions to continue.';
  }
  if (status === 'CANCELLED') {
    return 'This batch was cancelled. Start Conversion is unavailable.';
  }
  return 'This batch is not eligible for Start Conversion.';
}

const DEFAULT_TUNE_SETTINGS: TuneSettings = {
  colorMode: 'binary',
  preUpscaleBlur: FACTORY_TUNING_EXPORT_DEFAULTS.preUpscaleBlur,
  blur: FACTORY_TUNING_EXPORT_DEFAULTS.preprocessingBlur,
  blurPasses: FACTORY_TUNING_EXPORT_DEFAULTS.blurPasses,
  pathPrecision: FACTORY_TUNING_EXPORT_DEFAULTS.pathPrecision,
  cornerThreshold: FACTORY_TUNING_EXPORT_DEFAULTS.cornerThreshold,
  filterSpeckle: FACTORY_TUNING_EXPORT_DEFAULTS.filterSpeckle,
  lengthThreshold: FACTORY_TUNING_EXPORT_DEFAULTS.lengthThreshold,
  spliceThreshold: FACTORY_TUNING_EXPORT_DEFAULTS.spliceThreshold,
  colorPrecision: FACTORY_TUNING_EXPORT_DEFAULTS.colorPrecision,
  layerDifference: FACTORY_TUNING_EXPORT_DEFAULTS.layerDifference,
};

function getTuneSettingsFromSiteSettings(
  settings?: Partial<TuningExportSettings> & { cncMode?: boolean; colorMode?: 'color' | 'binary' }
): TuneSettings {
  return {
    colorMode: settings?.colorMode ?? (settings?.cncMode === false ? 'color' : 'binary'),
    preUpscaleBlur: settings?.preUpscaleBlur ?? DEFAULT_TUNE_SETTINGS.preUpscaleBlur,
    blur: settings?.preprocessingBlur ?? DEFAULT_TUNE_SETTINGS.blur,
    blurPasses: settings?.blurPasses ?? DEFAULT_TUNE_SETTINGS.blurPasses,
    pathPrecision: settings?.pathPrecision ?? DEFAULT_TUNE_SETTINGS.pathPrecision,
    cornerThreshold: settings?.cornerThreshold ?? DEFAULT_TUNE_SETTINGS.cornerThreshold,
    filterSpeckle: settings?.filterSpeckle ?? DEFAULT_TUNE_SETTINGS.filterSpeckle,
    lengthThreshold: settings?.lengthThreshold ?? DEFAULT_TUNE_SETTINGS.lengthThreshold,
    spliceThreshold: settings?.spliceThreshold ?? DEFAULT_TUNE_SETTINGS.spliceThreshold,
    colorPrecision: settings?.colorPrecision ?? DEFAULT_TUNE_SETTINGS.colorPrecision,
    layerDifference: settings?.layerDifference ?? DEFAULT_TUNE_SETTINGS.layerDifference,
  };
}

const TUNE_CONTROLS: Array<{
  key: Exclude<keyof TuneSettings, 'colorMode'>;
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
    help: 'Higher values preserve/detect more hard corners and sharp angles. Lower values smooth or round corners and treat more transitions as curves.',
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
  const searchParams = useSearchParams();
  const batchId = params.batchId as string;
  const requestedItemId = searchParams.get('itemId');

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalUpscale, setGlobalUpscale] = useState<number>(2);
  const [substitutions, setSubstitutions] = useState<SubstitutionRow[]>([]);
  const [tuneItem, setTuneItem] = useState<BatchItem | null>(null);
  const [siteTuneDefaults, setSiteTuneDefaults] = useState<TuneSettings>(DEFAULT_TUNE_SETTINGS);
  const [tuneSettings, setTuneSettings] = useState<TuneSettings>(DEFAULT_TUNE_SETTINGS);
  const [tunePreview, setTunePreview] = useState<TunePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [previewStatusMessage, setPreviewStatusMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savedFiles, setSavedFiles] = useState<SavedOutputFile[]>([]);
  const [savedOutputFolderPath, setSavedOutputFolderPath] = useState<string | null>(null);
  const [localEditorMessage, setLocalEditorMessage] = useState<string | null>(null);
  const [svgZoom, setSvgZoom] = useState(1);
  const [autoOpenedItemId, setAutoOpenedItemId] = useState<string | null>(null);

  const pendingItems = items.filter((item) => item.status === 'PENDING');
  const manualEditItems = items.filter((item) => item.status === 'NEEDS_MANUAL_EDIT');
  const readyItems = items.filter((item) => item.status === 'READY_TO_PROCESS');
  const completedItems = items.filter((item) => item.status === 'COMPLETED');
  const nonCancelledItems = items.filter((item) => item.status !== 'CANCELLED');
  const canStartConversion =
    batch?.status === 'READY_TO_PROCESS' &&
    nonCancelledItems.length > 0 &&
    nonCancelledItems.every((item) => item.status === 'READY_TO_PROCESS');
  const canEditBatchSettings = batch?.status === 'PENDING';
  const statusMessage = getStatusMessage(
    batch?.status,
    pendingItems.length,
    manualEditItems.length,
    readyItems.length,
    completedItems.length
  );

  // Fetch batch items
  const fetchBatch = async (options: { keepLoading?: boolean } = {}) => {
    if (!options.keepLoading) {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/batches/${batchId}/items`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to load batch');
        return false;
      }

      setBatch(data.batch);
      setItems(data.items);
      setGlobalUpscale(data.batch.upscaleFactor);
      return true;
    } catch {
      setError('Failed to load batch data');
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatch();
  }, [batchId]);

  useEffect(() => {
    async function fetchSiteSettings() {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (res.ok && data.success && data.settings) {
          const defaults = getTuneSettingsFromSiteSettings(data.settings);
          setSiteTuneDefaults(defaults);
          setTuneSettings((current) =>
            tuneItem ? current : defaults
          );
        }
      } catch {
        // Keep factory defaults if settings cannot be loaded.
      }
    }

    fetchSiteSettings();
  }, [tuneItem]);

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

  const getSavedFilesForItem = (item: BatchItem): SavedOutputFile[] => {
    if (!item.files) return [];

    return (Object.entries(item.files) as Array<['svg' | 'png' | 'jpg', { exists: boolean; path: string | null }]>)
      .filter(([, file]) => file.exists && file.path)
      .map(([type, file]) => ({
        type,
        filename: file.path!.split(/[\\/]/).pop() || `${item.baseName}.${type}`,
        path: file.path!,
        size: 0,
      }));
  };

  const openTunePanel = (item: BatchItem) => {
    const existingFiles = getSavedFilesForItem(item);
    setTuneItem(item);
    setTuneSettings(siteTuneDefaults);
    setTunePreview(null);
    setPreviewError(null);
    setPreviewStatus('idle');
    setPreviewStatusMessage(null);
    setSaveStatus(existingFiles.length > 0 ? 'success' : 'idle');
    setSaveMessage(
      existingFiles.length > 0
        ? 'Existing saved outputs loaded. Continue editing, open files, or mark Ready To Process.'
        : null
    );
    setSavedFiles(existingFiles);
    setSavedOutputFolderPath(item.outputFolderPath || null);
    setLocalEditorMessage(null);
    setSvgZoom(1);
  };

  useEffect(() => {
    if (!requestedItemId || loading || autoOpenedItemId === requestedItemId) return;

    const item = items.find((candidate) => candidate.id === requestedItemId);
    if (!item) return;

    openTunePanel(item);
    setAutoOpenedItemId(requestedItemId);
  }, [requestedItemId, loading, autoOpenedItemId, items, siteTuneDefaults]);

  const updateTuneSetting = (key: Exclude<keyof TuneSettings, 'colorMode'>, value: number) => {
    setTuneSettings((prev) => ({ ...prev, [key]: value }));
  };

  const updateTuneColorMode = (colorMode: 'color' | 'binary') => {
    setTuneSettings((prev) => ({ ...prev, colorMode }));
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

  const approveAndSaveItem = async () => {
    if (!tuneItem || !tunePreview) return;

    setSaveStatus('saving');
    setSaveMessage('Saving approved SVG, PNG, and JPG...');

    try {
      const res = await fetch(
        `/api/batches/${batchId}/items/${tuneItem.id}/approve-save`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tuneSettings),
        }
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        const message = data.message || data.error || 'Failed to save approved item';
        setSaveStatus('error');
        setSaveMessage(message);
        return;
      }

      const warningText =
        Array.isArray(data.warnings) && data.warnings.length > 0
          ? ` ${data.warnings.join(' ')}`
          : '';
      setSaveStatus('success');
      setSaveMessage(`Saved SVG, PNG, and JPG.${warningText}`);
      setSavedFiles(Array.isArray(data.files) ? data.files : []);
      setSavedOutputFolderPath(data.outputFolderPath || null);
      setLocalEditorMessage(null);
      setItems((prev) =>
        prev.map((item) =>
          item.id === tuneItem.id ? { ...item, status: data.itemStatus || 'NEEDS_MANUAL_EDIT' } : item
        )
      );
    } catch {
      setSaveStatus('error');
      setSaveMessage('Failed to save approved item');
    }
  };

  const updateManualEditStatus = async (
    action: ManualEditAction,
    options: { closePanel?: boolean } = {}
  ) => {
    if (!tuneItem) return false;

    const shouldClosePanel = options.closePanel ?? true;
    setLocalEditorMessage(action === 'ready_to_process' ? 'Marking item ready to process...' : 'Marking item as needing manual edit...');

    try {
      const res = await fetch(
        `/api/batches/${batchId}/items/${tuneItem.id}/manual-edit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        setLocalEditorMessage(data.error || 'Failed to update manual edit status');
        return false;
      }

      const itemStatus = data.itemStatus || (action === 'ready_to_process' ? 'READY_TO_PROCESS' : 'NEEDS_MANUAL_EDIT');
      setItems((prev) =>
        prev.map((item) =>
          item.id === tuneItem.id ? { ...item, status: itemStatus } : item
        )
      );
      setLocalEditorMessage(
        action === 'ready_to_process'
          ? 'Marked Ready To Process.'
          : 'Saved outputs and marked as Needs Manual Edit.'
      );
      if (shouldClosePanel) {
        setTuneItem(null);
        setNotice(
          action === 'ready_to_process'
            ? `${tuneItem.baseName} marked Ready To Process.`
            : `${tuneItem.baseName} saved and marked as Needs Manual Edit.`
        );
        await fetchBatch({ keepLoading: true });
      }
      return true;
    } catch {
      setLocalEditorMessage('Failed to update manual edit status');
      return false;
    }
  };

  const openEditableFilesForManualEdit = async () => {
    const updated = await updateManualEditStatus('needs_manual_edit', { closePanel: false });
    if (!updated) return;
    await openLocalEditor('editable');
  };

  const openItemLocalTarget = async (
    item: BatchItem,
    action: 'file' | 'folder' | 'editable',
    fileType?: string
  ) => {
    const itemFiles = getSavedFilesForItem(item);

    if (!item.outputFolderPath) {
      setError('No output folder is available for this item.');
      return;
    }

    setError(null);
    setNotice(null);

    try {
      const res = await fetch('/api/local-editor/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          fileType,
          files: itemFiles,
          outputFolderPath: item.outputFolderPath,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to open local target');
      }
    } catch {
      setError('Failed to open local target');
    }
  };

  const processReadyItem = async (item: BatchItem) => {
    setError(null);
    setNotice(null);

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, itemId: item.id }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to process item');
        return;
      }

      await fetchBatch({ keepLoading: true });
      setNotice(data.message || 'Item processed successfully.');
    } catch {
      setError('Failed to process item');
    }
  };

  const markItemReadyFromCard = async (item: BatchItem) => {
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(
        `/api/batches/${batchId}/items/${item.id}/manual-edit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ready_to_process' }),
        }
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to mark item ready');
        return;
      }

      await fetchBatch({ keepLoading: true });
      setNotice(`${item.baseName} marked Ready To Process.`);
    } catch {
      setError('Failed to mark item ready');
    }
  };

  const openLocalEditor = async (action: 'file' | 'folder' | 'editable', fileType?: string) => {
    if (!savedOutputFolderPath) {
      setLocalEditorMessage('No saved output folder is available yet.');
      return;
    }

    setLocalEditorMessage('Opening local editor...');

    try {
      const res = await fetch('/api/local-editor/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          fileType,
          files: savedFiles,
          outputFolderPath: savedOutputFolderPath,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setLocalEditorMessage(data.error || 'Failed to open local editor');
        return;
      }

      setLocalEditorMessage('Opened local target.');
    } catch {
      setLocalEditorMessage('Failed to open local editor');
    }
  };

  // Save changes
  const saveChanges = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);

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
    if (!canStartConversion) {
      await fetchBatch({ keepLoading: true });
      setNotice('Every non-cancelled item must be Ready To Process before batch Start Conversion is available.');
      return;
    }

    setConverting(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const message = data.error || 'Failed to start conversion';
        if (message.includes('Ready To Process') || message.includes('already been started') || message.includes('processable')) {
          await fetchBatch({ keepLoading: true });
          setNotice('This batch is not currently eligible for Start Conversion. The page has been refreshed with the current status.');
        } else {
          setError(message);
        }
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
            {statusMessage || 'Review and edit base names, set upscale factors before conversion.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canEditBatchSettings && (
            <button
              onClick={saveChanges}
              disabled={saving}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
          {canStartConversion && (
            <button
              onClick={startConversion}
              disabled={converting}
              className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {converting ? 'Starting...' : 'Start Conversion'}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {notice}
        </div>
      )}

      {batch && !canStartConversion && statusMessage && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {statusMessage}
        </div>
      )}

      {/* Global Upscale Control */}
      {canEditBatchSettings && (
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
      )}

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
                <span className="mt-1 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                  {item.status}
                </span>
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
                  disabled={!canEditBatchSettings || item.status !== 'PENDING'}
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
                  disabled={!canEditBatchSettings || item.status !== 'PENDING'}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value={1}>1x (No upscale)</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>

              {item.status === 'PENDING' && (
                <button
                  onClick={() => openTunePanel(item)}
                  className="w-full rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  Preview/Tune
                </button>
              )}

              {item.status === 'NEEDS_MANUAL_EDIT' && (
                <div className="space-y-2">
                  <button
                    onClick={() => openTunePanel(item)}
                    className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
                  >
                    Continue Editing
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => openItemLocalTarget(item, 'editable')}
                      className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Open Editable Files
                    </button>
                    <button
                      onClick={() => markItemReadyFromCard(item)}
                      className="rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
                    >
                      Mark Ready
                    </button>
                  </div>
                </div>
              )}

              {item.status === 'READY_TO_PROCESS' && (
                <div className="space-y-2">
                  <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
                    Ready To Process
                  </p>
                  <button
                    onClick={() => processReadyItem(item)}
                    className="w-full rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700"
                  >
                    Process Item
                  </button>
                </div>
              )}

              {item.status === 'COMPLETED' && (
                <div className="space-y-2">
                  <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
                    Completed
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {item.outputFolderPath && (
                      <button
                        onClick={() => openItemLocalTarget(item, 'folder')}
                        className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Open Output Folder
                      </button>
                    )}
                    {item.zipPath && (
                      <a
                        href={`/api/batches/${batchId}/download?itemId=${item.id}`}
                        className="rounded-md border border-gray-300 px-3 py-2 text-center text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Download ZIP
                      </a>
                    )}
                  </div>
                </div>
              )}
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
            {canStartConversion
              ? `${readyItems.length} image${readyItems.length > 1 ? 's' : ''} ready for final package generation`
              : statusMessage || `${items.length} image${items.length > 1 ? 's' : ''} loaded`}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/upload')}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Back to Upload
            </button>
            {canStartConversion && (
              <button
                onClick={startConversion}
                disabled={converting}
                className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {converting ? 'Starting...' : 'Start Conversion'}
              </button>
            )}
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
                      onClick={() => setTuneSettings(siteTuneDefaults)}
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
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-medium text-gray-700">
                        Color Mode
                      </label>
                      <select
                        value={tuneSettings.colorMode}
                        onChange={(e) => updateTuneColorMode(e.target.value as 'color' | 'binary')}
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="binary">binary</option>
                        <option value="color">color</option>
                      </select>
                    </div>

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
                    {tunePreview && (
                      <button
                        onClick={approveAndSaveItem}
                        disabled={saveStatus === 'saving'}
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
                      >
                        {saveStatus === 'saving' ? 'Saving...' : 'Approve & Save This Item'}
                      </button>
                    )}
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

                {saveMessage && (
                  <div className="mb-4 space-y-3">
                    <div
                      className={`rounded-md border p-3 text-sm ${
                        saveStatus === 'success'
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : saveStatus === 'error'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-gray-200 bg-gray-50 text-gray-700'
                      }`}
                    >
                      {saveMessage}
                    </div>

                    {saveStatus === 'success' && savedFiles.length > 0 && (
                      <div className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                          <p className="text-sm font-semibold text-amber-900">
                            Are the saved files ready for final processing?
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => updateManualEditStatus('ready_to_process')}
                              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                            >
                              Yes, files are ready / Mark Ready To Process
                            </button>
                            <button
                              type="button"
                              onClick={openEditableFilesForManualEdit}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                            >
                              No, open editable files
                            </button>
                            <button
                              type="button"
                              onClick={() => updateManualEditStatus('needs_manual_edit')}
                              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                            >
                              Save outputs but mark as Needs Manual Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setTuneItem(null)}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Cancel / come back later
                            </button>
                          </div>
                        </div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            Local Only
                          </span>
                          <p className="text-xs text-gray-500">
                            Open approved files on this machine with your configured editor.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {['PNG', 'JPG', 'SVG'].map((fileType) => (
                            <button
                              key={fileType}
                              type="button"
                              onClick={() => openLocalEditor('file', fileType)}
                              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Open {fileType}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => openLocalEditor('folder')}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Open Output Folder
                          </button>
                          <button
                            type="button"
                            onClick={() => openLocalEditor('editable')}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            Open Editable Files
                          </button>
                        </div>
                        {localEditorMessage && (
                          <p className="mt-2 text-xs text-gray-600">{localEditorMessage}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

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
