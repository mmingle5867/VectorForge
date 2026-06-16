'use client';

import { useState, useEffect, type MouseEvent, type WheelEvent } from 'react';
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
  svgCanvasPaddingPx: number;
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
type PreviewViewMode = 'processed' | 'split' | 'original';
type TuneTab = 'controls' | 'details' | 'warnings';
type Point = { x: number; y: number };

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
  svgCanvasPaddingPx: FACTORY_TUNING_EXPORT_DEFAULTS.svgCanvasPaddingPx,
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
    svgCanvasPaddingPx: settings?.svgCanvasPaddingPx ?? DEFAULT_TUNE_SETTINGS.svgCanvasPaddingPx,
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
    key: 'svgCanvasPaddingPx',
    label: 'SVG Canvas Padding',
    min: 0,
    max: 100,
    step: 1,
    help: 'Adds final SVG viewport padding after tracing. This does not move, scale, or repair paths.',
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

const TUNE_CONTROL_GROUPS: Array<{
  title: string;
  keys: Array<Exclude<keyof TuneSettings, 'colorMode'>>;
}> = [
  {
    title: 'Vectorization',
    keys: ['pathPrecision', 'cornerThreshold', 'lengthThreshold', 'spliceThreshold'],
  },
  {
    title: 'Cleanup',
    keys: ['preUpscaleBlur', 'blur', 'blurPasses', 'filterSpeckle'],
  },
  {
    title: 'Export',
    keys: ['svgCanvasPaddingPx', 'colorPrecision', 'layerDifference'],
  },
];

const RASTER_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
]);
const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

function getFileExtension(filename: string) {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index).toLowerCase() : '';
}

function isRasterUpload(item: BatchItem) {
  const mimeType = (item.mimeType || '').toLowerCase();
  const extension = getFileExtension(item.originalFilename);
  return mimeType !== 'image/svg+xml' && (
    RASTER_MIME_TYPES.has(mimeType) || RASTER_EXTENSIONS.has(extension)
  );
}

function hasSavedSvgFile(item: BatchItem | null, savedFiles: SavedOutputFile[]) {
  return Boolean(
    savedFiles.some((file) => file.type.toLowerCase() === 'svg') ||
      item?.files?.svg?.exists
  );
}

function mergeSavedFile(files: SavedOutputFile[], nextFile: SavedOutputFile) {
  const nextType = nextFile.type.toLowerCase();
  const withoutType = files.filter((file) => file.type.toLowerCase() !== nextType);
  return [...withoutType, nextFile];
}

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
  const [editableVectorPath, setEditableVectorPath] = useState<string | null>(null);
  const [localEditorMessage, setLocalEditorMessage] = useState<string | null>(null);
  const [svgZoom, setSvgZoom] = useState(1);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>('processed');
  const [tuneTab, setTuneTab] = useState<TuneTab>('controls');
  const [tunePanelCollapsed, setTunePanelCollapsed] = useState(false);
  const [compactTunePanel, setCompactTunePanel] = useState(false);
  const [tunePanelPosition, setTunePanelPosition] = useState<Point>({ x: 0, y: 0 });
  const [panelDragStart, setPanelDragStart] = useState<{ pointer: Point; panel: Point } | null>(null);
  const [canvasPan, setCanvasPan] = useState<Point>({ x: 0, y: 0 });
  const [canvasPanStart, setCanvasPanStart] = useState<{ pointer: Point; pan: Point } | null>(null);
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
    setEditableVectorPath(existingFiles.find((file) => file.type.toLowerCase() === 'svg')?.path || null);
    setLocalEditorMessage(null);
    setSvgZoom(1);
    setPreviewViewMode('processed');
    setTuneTab('controls');
    setTunePanelCollapsed(false);
    setTunePanelPosition({ x: 0, y: 0 });
    setCanvasPan({ x: 0, y: 0 });
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

  const previewWarnings = [
    ...(previewError ? [previewError] : []),
    ...(tunePreview && tunePreview.diagnostics.pathCount === 0
      ? ['No SVG paths were detected in the generated preview.']
      : []),
    ...(tunePreview &&
    tunePreview.diagnostics.hasVisibleStroke &&
    !tunePreview.diagnostics.hasVisibleFill
      ? ['SVG contains visible strokes but no visible fills. Manual fill may be required.']
      : []),
    ...(tunePreview && tunePreview.upscaleApplied
      ? [`Large or low-resolution source was processed after ${tunePreview.upscaleFactor}x smart upscale.`]
      : []),
    ...(tunePreview && tunePreview.diagnostics.pathCount > 10000
      ? ['High path count may produce a complex package and slower downstream editing.']
      : []),
  ];
  const canOpenOriginalRaster = tuneItem ? isRasterUpload(tuneItem) : false;
  const canOpenEditableVector = Boolean(tuneItem && (tunePreview || hasSavedSvgFile(tuneItem, savedFiles)));
  const canCopyEditableVectorPath = canOpenEditableVector;
  const canReloadEditedVector = Boolean(tuneItem && hasSavedSvgFile(tuneItem, savedFiles));

  const zoomPreview = (direction: 'in' | 'out') => {
    setSvgZoom((prev) => {
      const delta = direction === 'in' ? 0.25 : -0.25;
      return Math.min(6, Math.max(0.25, Number((prev + delta).toFixed(2))));
    });
  };

  const wheelZoomPreview = (deltaY: number) => {
    setSvgZoom((prev) => {
      const normalizedSteps = Math.max(-4, Math.min(4, deltaY / 100));
      const scale = 1 - normalizedSteps * 0.05;
      return Math.min(6, Math.max(0.25, Number((prev * scale).toFixed(3))));
    });
  };

  const resetPreviewZoom = () => {
    setSvgZoom(1);
    setCanvasPan({ x: 0, y: 0 });
  };

  const fitPreviewToScreen = () => {
    setSvgZoom(1);
    setCanvasPan({ x: 0, y: 0 });
  };

  const handleCanvasWheel = (event: WheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-floating-panel="true"]')) return;
    if (!tunePreview && previewViewMode === 'processed') return;

    event.preventDefault();
    wheelZoomPreview(event.deltaY);
  };

  const beginCanvasPan = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-floating-panel="true"]')) return;
    setCanvasPanStart({
      pointer: { x: event.clientX, y: event.clientY },
      pan: canvasPan,
    });
  };

  const updateCanvasPan = (event: MouseEvent<HTMLDivElement>) => {
    if (!canvasPanStart) return;

    setCanvasPan({
      x: canvasPanStart.pan.x + event.clientX - canvasPanStart.pointer.x,
      y: canvasPanStart.pan.y + event.clientY - canvasPanStart.pointer.y,
    });
  };

  const endCanvasPan = () => {
    setCanvasPanStart(null);
  };

  const beginPanelDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    setPanelDragStart({
      pointer: { x: event.clientX, y: event.clientY },
      panel: tunePanelPosition,
    });
  };

  const updatePanelDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (!panelDragStart) return;

    const nextX = panelDragStart.panel.x + event.clientX - panelDragStart.pointer.x;
    const nextY = panelDragStart.panel.y + event.clientY - panelDragStart.pointer.y;
    setTunePanelPosition({
      x: Math.min(760, Math.max(-760, nextX)),
      y: Math.min(520, Math.max(-80, nextY)),
    });
  };

  const endPanelDrag = () => {
    setPanelDragStart(null);
  };

  const resetPanelPosition = () => {
    setTunePanelPosition({ x: 0, y: 0 });
  };

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
      setPreviewStatusMessage(
        editableVectorPath
          ? 'Preview regenerated from raster. The tracked editable SVG was not overwritten.'
          : 'Preview generated successfully'
      );
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
          body: JSON.stringify({
            ...tuneSettings,
            approvedSvgBase64:
              editableVectorPath && tunePreview.debugSvgPath === editableVectorPath
                ? tunePreview.svgBase64
                : undefined,
          }),
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
      setEditableVectorPath(
        Array.isArray(data.files)
          ? data.files.find((file: SavedOutputFile) => file.type.toLowerCase() === 'svg')?.path || null
          : null
      );
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

  const openOriginalRaster = async () => {
    if (!tuneItem) return;

    setLocalEditorMessage('Opening original raster...');

    try {
      const res = await fetch('/api/local-editor/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'original-raster',
          batchId,
          itemId: tuneItem.id,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setLocalEditorMessage(data.error || 'Failed to open original raster');
        return;
      }

      setLocalEditorMessage('Opened original raster. Save it in the editor, then Generate Preview again.');
    } catch {
      setLocalEditorMessage('Failed to open original raster');
    }
  };

  const openEditableVector = async () => {
    if (!tuneItem) return;

    setLocalEditorMessage('Opening editable vector...');

    try {
      const res = await fetch(
        `/api/batches/${batchId}/items/${tuneItem.id}/editable-vector`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'open',
            previewSvgBase64: tunePreview?.svgBase64,
          }),
        }
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        setLocalEditorMessage(data.error || 'Failed to open editable vector');
        return;
      }

      if (data.outputFolderPath) {
        setSavedOutputFolderPath(data.outputFolderPath);
      }
      if (data.file) {
        setSavedFiles((files) => mergeSavedFile(files, data.file));
        setEditableVectorPath(data.file.path);
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === tuneItem.id
            ? {
                ...item,
                outputFolderPath: data.outputFolderPath || item.outputFolderPath,
                files: {
                  ...(item.files || {}),
                  svg: {
                    exists: true,
                    path: data.file?.path || item.files?.svg?.path || null,
                  },
                } as BatchItem['files'],
              }
            : item
        )
      );
      setLocalEditorMessage('Opened editable vector. Save it, then Reload Edited Vector.');
    } catch {
      setLocalEditorMessage('Failed to open editable vector');
    }
  };

  const copyEditableVectorPath = async () => {
    if (!tuneItem) return;

    setLocalEditorMessage('Preparing editable vector path...');

    try {
      const res = await fetch(
        `/api/batches/${batchId}/items/${tuneItem.id}/editable-vector`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'prepare',
            previewSvgBase64: tunePreview?.svgBase64,
          }),
        }
      );
      const data = await res.json();

      if (!res.ok || !data.success || !data.file?.path) {
        setLocalEditorMessage(data.error || 'Generate preview first, then copy the editable vector path.');
        return;
      }

      if (data.outputFolderPath) {
        setSavedOutputFolderPath(data.outputFolderPath);
      }
      setSavedFiles((files) => mergeSavedFile(files, data.file));
      setEditableVectorPath(data.file.path);

      try {
        await navigator.clipboard.writeText(data.file.path);
        setLocalEditorMessage('Copied editable vector path to clipboard.');
      } catch {
        setLocalEditorMessage(`Editable vector path: ${data.file.path}`);
      }
    } catch {
      setLocalEditorMessage('Failed to prepare editable vector path');
    }
  };

  const reloadEditedVector = async () => {
    if (!tuneItem) return;

    setLocalEditorMessage('Reloading edited vector...');

    try {
      const res = await fetch(
        `/api/batches/${batchId}/items/${tuneItem.id}/editable-vector`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reload' }),
        }
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        setLocalEditorMessage(data.error || 'Failed to reload edited vector');
        return;
      }

      const fallbackWidth = tuneItem.originalWidth || 1200;
      const fallbackHeight = tuneItem.originalHeight || 1200;
      setTunePreview((preview) => ({
        svgBase64: data.svgBase64,
        svgSize: data.svgSize,
        debugSvgPath: data.svgPath,
        diagnostics: data.diagnostics,
        originalWidth: preview?.originalWidth ?? fallbackWidth,
        originalHeight: preview?.originalHeight ?? fallbackHeight,
        traceWidth: preview?.traceWidth ?? fallbackWidth,
        traceHeight: preview?.traceHeight ?? fallbackHeight,
        upscaleApplied: preview?.upscaleApplied ?? false,
        upscaleFactor: preview?.upscaleFactor ?? tuneItem.upscaleFactor,
        processingTimeMs: 0,
      }));
      if (data.file) {
        setSavedFiles((files) => mergeSavedFile(files, data.file));
        setEditableVectorPath(data.file.path);
      }
      setPreviewStatus('success');
      setPreviewStatusMessage('Reloaded edited vector from disk');
      setLocalEditorMessage('Reloaded edited vector from disk.');
    } catch {
      setLocalEditorMessage('Failed to reload edited vector');
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
          <div className="max-h-[94vh] w-full max-w-7xl overflow-hidden rounded-lg bg-white shadow-xl">
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

            <div
              className="relative h-[calc(94vh-73px)] overflow-hidden bg-gray-100"
              onMouseMove={(event) => {
                updatePanelDrag(event);
                updateCanvasPan(event);
              }}
              onMouseUp={() => {
                endPanelDrag();
                endCanvasPan();
              }}
              onMouseLeave={() => {
                endPanelDrag();
                endCanvasPan();
              }}
            >
              <div className="absolute inset-0 flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white/95 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className={`rounded-md border px-2.5 py-1.5 text-xs ${PREVIEW_STATUS_STYLES[previewStatus]}`}>
                      <span className="font-semibold">Preview</span>
                      {previewStatusMessage && <span className="ml-2">{previewStatusMessage}</span>}
                    </div>
                    {(['processed', 'split', 'original'] as PreviewViewMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPreviewViewMode(mode)}
                        className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                          previewViewMode === mode
                            ? 'bg-gray-900 text-white'
                            : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {mode === 'processed' ? 'Processed' : mode === 'split' ? 'Split View' : 'Original'}
                      </button>
                    ))}
                    <button
                      onClick={() => zoomPreview('out')}
                      disabled={!tunePreview && previewViewMode === 'processed'}
                      className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Zoom Out
                    </button>
                    <span className="w-12 text-center text-xs font-medium text-gray-600">
                      {Math.round(svgZoom * 100)}%
                    </span>
                    <button
                      onClick={() => zoomPreview('in')}
                      disabled={!tunePreview && previewViewMode === 'processed'}
                      className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Zoom In
                    </button>
                    <button
                      onClick={resetPreviewZoom}
                      disabled={!tunePreview && previewViewMode === 'processed'}
                      className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Reset
                    </button>
                    <button
                      onClick={fitPreviewToScreen}
                      disabled={!tunePreview && previewViewMode === 'processed'}
                      className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Fit
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tunePreview && (
                      <button
                        onClick={approveAndSaveItem}
                        disabled={saveStatus === 'saving'}
                        className="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
                      >
                        {saveStatus === 'saving' ? 'Saving...' : 'Approve & Save'}
                      </button>
                    )}
                    <a
                      href={previewSvgDataUrl}
                      download={tuneItem ? `${tuneItem.baseName || tuneItem.id}-preview.svg` : 'preview.svg'}
                      className={`rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${
                        tunePreview ? '' : 'pointer-events-none opacity-50'
                      }`}
                    >
                      Download SVG
                    </a>
                  </div>
                </div>

                <div
                  className={`relative flex-1 overflow-hidden p-3 ${canvasPanStart ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onWheel={handleCanvasWheel}
                  onMouseDown={beginCanvasPan}
                >
                  <div className="grid h-full grid-cols-1 gap-3">
                    {previewViewMode !== 'processed' && (
                      <div className={`${previewViewMode === 'split' ? 'md:col-start-1 md:row-start-1 md:w-[calc(50%-0.375rem)]' : 'h-full'}`}>
                        <div className="mb-2 flex items-center justify-between text-xs text-gray-600">
                          <span className="font-semibold text-gray-800">Original</span>
                          {tuneItem.originalWidth && tuneItem.originalHeight && (
                            <span>{tuneItem.originalWidth} x {tuneItem.originalHeight}px</span>
                          )}
                        </div>
                        <div className="flex h-[calc(100%-1.5rem)] items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <img
                            src={tuneItem.previewUrl}
                            alt={tuneItem.originalFilename}
                            className="max-h-full max-w-full object-contain"
                            draggable={false}
                            style={{
                              transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${svgZoom})`,
                              transformOrigin: 'center center',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {previewViewMode !== 'original' && (
                      <div className={`${previewViewMode === 'split' ? 'md:col-start-1 md:row-start-1 md:ml-[calc(50%+0.375rem)] md:w-[calc(50%-0.375rem)]' : 'h-full'}`}>
                        <div className="mb-2 flex items-center justify-between text-xs text-gray-600">
                          <span className="font-semibold text-gray-800">Processed</span>
                          {tunePreview && <span>{tunePreview.traceWidth} x {tunePreview.traceHeight}px</span>}
                        </div>
                        <div
                          className="h-[calc(100%-1.5rem)] overflow-auto rounded-lg border border-gray-200"
                          style={{
                            backgroundColor: '#f8fafc',
                            backgroundImage:
                              'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                            backgroundSize: '24px 24px',
                            backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
                          }}
                        >
                          <div className="flex min-h-full min-w-full items-center justify-center p-6">
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
                                  transform: `translate(${canvasPan.x}px, ${canvasPan.y}px)`,
                                }}
                                draggable={false}
                              />
                            ) : (
                              <div className="rounded-md bg-white/90 px-6 py-4 text-center text-sm text-gray-500 shadow-sm">
                                Adjust settings, then generate a preview for this item.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {saveMessage && (
                    <div className="absolute bottom-3 left-3 max-w-3xl space-y-2 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg">
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
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
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
                          <div>
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
                          </div>
                        </div>
                      )}
                      {localEditorMessage && (
                        <p className="text-xs text-gray-600">{localEditorMessage}</p>
                      )}
                    </div>
                  )}
                </div>

                <aside
                  data-floating-panel="true"
                  className="absolute right-3 top-16 z-10 w-[min(360px,calc(100%-1.5rem))] overflow-hidden rounded-lg border border-gray-200 bg-white/95 shadow-2xl backdrop-blur"
                  style={{
                    transform: `translate(${tunePanelPosition.x}px, ${tunePanelPosition.y}px)`,
                  }}
                >
                  <div
                    className={`flex cursor-move items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 ${panelDragStart ? 'bg-blue-50' : ''}`}
                    onMouseDown={beginPanelDrag}
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-gray-900">Controls</h3>
                      <p className="truncate text-[11px] text-gray-500">{tuneItem.originalFilename}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          resetPanelPosition();
                        }}
                        className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Reset Pos
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setCompactTunePanel((value) => !value);
                        }}
                        className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {compactTunePanel ? 'Normal' : 'Compact'}
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setTunePanelCollapsed((value) => !value);
                        }}
                        className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {tunePanelCollapsed ? 'Expand' : 'Minimize'}
                      </button>
                    </div>
                  </div>

                  {!tunePanelCollapsed && (
                    <div className="max-h-[calc(94vh-136px)] overflow-y-auto">
                      <div className={`border-b border-gray-200 ${compactTunePanel ? 'p-2' : 'p-3'}`}>
                        <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
                          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                            <img
                              src={tuneItem.previewUrl}
                              alt={tuneItem.originalFilename}
                              className="h-full w-full object-contain"
                            />
                          </div>
                          <div className="min-w-0 text-xs text-gray-600">
                            <p className="truncate font-medium text-gray-900">{tuneItem.originalFilename}</p>
                            <p className="mt-1">{tuneItem.originalWidth && tuneItem.originalHeight ? `${tuneItem.originalWidth} x ${tuneItem.originalHeight}px` : 'Dimensions unknown'}</p>
                            <p className="mt-1">
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                                {tuneItem.status}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className={`grid grid-cols-2 gap-1.5 border-b border-gray-200 ${compactTunePanel ? 'p-2' : 'p-3'}`}>
                      <button
                        onClick={generatePreview}
                        disabled={previewLoading}
                        className="rounded-md bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        {previewLoading ? 'Generating...' : 'Generate Preview'}
                      </button>
                      <button
                        onClick={() => setTuneSettings(siteTuneDefaults)}
                        className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Restore Defaults
                      </button>
                      {savedFiles.length > 0 && (
                        <button
                          type="button"
                          onClick={() => openLocalEditor('editable')}
                          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Open Editable Files
                        </button>
                      )}
                      {canOpenOriginalRaster && (
                        <button
                          type="button"
                          onClick={openOriginalRaster}
                          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Open Original Raster
                        </button>
                      )}
                      {canOpenEditableVector && (
                        <button
                          type="button"
                          onClick={openEditableVector}
                          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Open Editable Vector
                        </button>
                      )}
                      {canCopyEditableVectorPath && (
                        <button
                          type="button"
                          onClick={copyEditableVectorPath}
                          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Copy Editable Vector Path
                        </button>
                      )}
                      {canReloadEditedVector && (
                        <button
                          type="button"
                          onClick={reloadEditedVector}
                          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Reload Edited Vector
                        </button>
                      )}
                      {tuneItem.status === 'NEEDS_MANUAL_EDIT' && (
                        <button
                          type="button"
                          onClick={() => setTuneTab('controls')}
                          className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                        >
                          Continue Editing
                        </button>
                      )}
                      {savedFiles.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => updateManualEditStatus('ready_to_process')}
                            className="rounded-md bg-green-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                          >
                            Mark Ready To Process
                          </button>
                          <button
                            type="button"
                            onClick={() => updateManualEditStatus('needs_manual_edit')}
                            className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                          >
                            Mark Needs Manual Edit
                          </button>
                        </>
                      )}
                      {tuneItem.status === 'READY_TO_PROCESS' && (
                        <button
                          type="button"
                          onClick={() => processReadyItem(tuneItem)}
                          className="rounded-md bg-green-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                        >
                          Start Conversion
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setTuneItem(null)}
                        className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Back
                      </button>
                      </div>
                      {localEditorMessage && (
                        <p className="border-b border-gray-200 px-3 py-2 text-xs text-gray-600">{localEditorMessage}</p>
                      )}

                      <div className="flex gap-1.5 border-b border-gray-200 px-2 py-2">
                        {(['controls', 'details'] as TuneTab[]).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setTuneTab(tab)}
                            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                              tuneTab === tab
                                ? 'bg-blue-600 text-white'
                                : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {tab === 'controls' ? 'Controls' : 'Details'}
                          </button>
                        ))}
                        {previewWarnings.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setTuneTab('warnings')}
                            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                              tuneTab === 'warnings'
                                ? 'bg-amber-600 text-white'
                                : 'border border-amber-300 text-amber-800 hover:bg-amber-50'
                            }`}
                          >
                            Warnings
                          </button>
                        )}
                      </div>

                      {tuneTab === 'controls' && (
                        <div className={compactTunePanel ? 'space-y-2 p-2' : 'space-y-3 p-3'}>
                          <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2">
                            <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700">
                              Color Mode
                              <button
                                type="button"
                                title="Controls whether preview tracing uses binary or color output."
                                aria-label="Color Mode help"
                                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500"
                              >
                                i
                              </button>
                            </label>
                            <select
                              value={tuneSettings.colorMode}
                              onChange={(e) => updateTuneColorMode(e.target.value as 'color' | 'binary')}
                              className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="binary">binary</option>
                              <option value="color">color</option>
                            </select>
                          </div>

                          {TUNE_CONTROL_GROUPS.map((group, groupIndex) => (
                            <details key={group.title} open={groupIndex < 2} className="rounded-md border border-gray-200 bg-white">
                              <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold text-gray-800">
                                {group.title}
                              </summary>
                              <div className={compactTunePanel ? 'space-y-2 px-2 pb-2' : 'space-y-3 px-2 pb-3'}>
                                {group.keys.map((key) => {
                                  const control = TUNE_CONTROLS.find((candidate) => candidate.key === key);
                                  if (!control) return null;

                                  return (
                                    <div key={control.key} className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-x-2 gap-y-1">
                                      <label className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium text-gray-700">
                                        <span className="truncate">{control.label}</span>
                                        <button
                                          type="button"
                                          title={control.help}
                                          aria-label={`${control.label} help`}
                                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500"
                                        >
                                          i
                                        </button>
                                      </label>
                                      <input
                                        type="number"
                                        min={control.min}
                                        max={control.max}
                                        step={control.step}
                                        value={tuneSettings[control.key]}
                                        onChange={(e) =>
                                          updateTuneSetting(control.key, Number(e.target.value))
                                        }
                                        className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-right text-[11px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      />
                                      <input
                                        type="range"
                                        min={control.min}
                                        max={control.max}
                                        step={control.step}
                                        value={tuneSettings[control.key]}
                                        onChange={(e) =>
                                          updateTuneSetting(control.key, Number(e.target.value))
                                        }
                                        className="col-span-2 h-4 w-full accent-blue-600"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          ))}
                        </div>
                      )}

                      {tuneTab === 'details' && (
                        <div className="space-y-3 p-3 text-xs text-gray-700">
                          <div className="grid grid-cols-2 gap-2">
                            <div><span className="font-medium">Status:</span> {tuneItem.status}</div>
                            <div><span className="font-medium">File Size:</span> {tuneItem.originalSize ? formatBytes(tuneItem.originalSize) : 'unknown'}</div>
                            <div><span className="font-medium">Dimensions:</span> {tuneItem.originalWidth && tuneItem.originalHeight ? `${tuneItem.originalWidth} x ${tuneItem.originalHeight}px` : 'unknown'}</div>
                            <div><span className="font-medium">DPI:</span> unknown</div>
                            <div><span className="font-medium">Colors:</span> {tuneSettings.colorMode}</div>
                            <div><span className="font-medium">Paths:</span> {tunePreview ? tunePreview.diagnostics.pathCount : 'not generated'}</div>
                            <div><span className="font-medium">Nodes:</span> not measured</div>
                            <div><span className="font-medium">Time:</span> {tunePreview ? `${tunePreview.processingTimeMs}ms` : 'not generated'}</div>
                            <div><span className="font-medium">Preview:</span> {tunePreview ? formatBytes(tunePreview.svgSize) : 'not generated'}</div>
                            <div><span className="font-medium">Trace:</span> {tunePreview ? `${tunePreview.traceWidth} x ${tunePreview.traceHeight}px` : 'not generated'}</div>
                          </div>

                          {tunePreview && (
                            <details className="rounded-md border border-gray-200 bg-gray-50">
                              <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold text-gray-800">
                                SVG Diagnostics
                              </summary>
                              <div className="grid grid-cols-2 gap-2 px-2 pb-2">
                                <div><span className="font-medium">Length:</span> {tunePreview.diagnostics.svgLength}</div>
                                <div><span className="font-medium">fill none:</span> {tunePreview.diagnostics.fillNoneCount}</div>
                                <div><span className="font-medium">stroke:</span> {tunePreview.diagnostics.strokeCount}</div>
                                <div><span className="font-medium">opacity 0:</span> {tunePreview.diagnostics.opacityZeroCount}</div>
                                <div><span className="font-medium">fill:</span> {tunePreview.diagnostics.hasVisibleFill ? 'yes' : 'no'}</div>
                                <div><span className="font-medium">visible stroke:</span> {tunePreview.diagnostics.hasVisibleStroke ? 'yes' : 'no'}</div>
                                <div className="col-span-2"><span className="font-medium">viewBox:</span> {tunePreview.diagnostics.viewBox || 'none'}</div>
                                <div><span className="font-medium">width:</span> {tunePreview.diagnostics.width || 'none'}</div>
                                <div><span className="font-medium">height:</span> {tunePreview.diagnostics.height || 'none'}</div>
                              </div>
                            </details>
                          )}
                        </div>
                      )}

                      {tuneTab === 'warnings' && previewWarnings.length > 0 && (
                        <div className="space-y-2 p-3">
                          {previewWarnings.map((warning, index) => (
                            <div key={`${warning}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                              {warning}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
