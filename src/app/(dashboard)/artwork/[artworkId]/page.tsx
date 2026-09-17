'use client';

import Link from 'next/link';
import RasterLayoutControls from '@/components/raster-layout-controls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type RasterChoice = { key: string; label?: string; versionNumber?: number; filePath: string; isCurrent?: boolean; width?: number | null; height?: number | null };
type TuneSettings = { colorMode: 'color' | 'binary'; binaryTraceColor: string; traceThicknessPx: number; preUpscaleBlur: number; blur: number; blurPasses: number; rasterSourcePaddingPx: number; svgCanvasPaddingPx: number; exportCanvasPaddingPx: number; pathPrecision: number; cornerThreshold: number; filterSpeckle: number; lengthThreshold: number; spliceThreshold: number; colorPrecision: number; layerDifference: number };
type NumericSetting = Exclude<keyof TuneSettings, 'colorMode' | 'binaryTraceColor'>;
type PreviewKind = 'svg' | 'png' | 'pngMask' | 'jpg' | 'pdf';
type SavedOutputs = { svg: boolean; png: boolean; jpg: boolean };
type ControlPreset = { id: string; name: string; description: string; settings: Partial<TuneSettings>; rasterPreparation: { blur: number; upscaleFactor: number } };

const DEFAULT_SETTINGS: TuneSettings = { colorMode: 'binary', binaryTraceColor: '#000000', traceThicknessPx: 0, preUpscaleBlur: 0, blur: 0, blurPasses: 1, rasterSourcePaddingPx: 20, svgCanvasPaddingPx: 20, exportCanvasPaddingPx: 0, pathPrecision: 3, cornerThreshold: 70, filterSpeckle: 6, lengthThreshold: 4, spliceThreshold: 45, colorPrecision: 6, layerDifference: 16 };
const TUNERS: Array<{ key: NumericSetting; label: string; help: string; min: number; max: number; step?: number }> = [
  { key: 'preUpscaleBlur', label: 'Pre-upscale blur', help: 'Softens small raster noise before enlargement. Use a low value for scanned line art; higher values can erase fine details.', min: 0, max: 5, step: 0.1 },
  { key: 'blurPasses', label: 'Blur passes', help: 'Repeats the pre-upscale smoothing. More passes remove more noise, but can round off thin lines and corners.', min: 1, max: 3 },
  { key: 'rasterSourcePaddingPx', label: 'Raster source padding', help: 'Expands or crops the raster area used for tracing before VectorForge creates the vector. Positive values keep more margin; negative values crop inward.', min: -100, max: 200 },
  { key: 'svgCanvasPaddingPx', label: 'SVG canvas padding', help: 'Adds transparent margin around the traced SVG canvas. It changes the SVG view box, not the line shape.', min: 0, max: 100 },
  { key: 'exportCanvasPaddingPx', label: 'Export canvas padding', help: 'Adds margin around the saved raster exports. Use it when a marketplace or downstream application needs space around the artwork.', min: 0, max: 300 },
  { key: 'pathPrecision', label: 'Path precision', help: 'Controls decimal precision in SVG path coordinates. Higher values preserve more detail but make larger SVG files; lower values simplify coordinates.', min: 0, max: 8 },
  { key: 'cornerThreshold', label: 'Corner threshold', help: 'Controls how readily the tracer treats a direction change as a corner. Higher values preserve sharper corners; lower values favor smoother curves.', min: 0, max: 180 },
  { key: 'filterSpeckle', label: 'Filter speckle', help: 'Removes tiny isolated regions created by image noise. Increase it to clean scans; keep it low to preserve intentional small details.', min: 0, max: 20 },
  { key: 'lengthThreshold', label: 'Length threshold', help: 'Sets the minimum feature length retained by the tracer. Higher values simplify short segments; lower values retain more small detail.', min: 3.5, max: 10, step: 0.1 },
  { key: 'spliceThreshold', label: 'Splice threshold', help: 'Controls when adjacent traced segments are joined. A higher value makes longer, smoother paths; a lower value retains more separate turns.', min: 0, max: 180 },
  { key: 'colorPrecision', label: 'Color precision', help: 'Sets how finely the color tracer distinguishes similar colors. Higher values retain more shades and create more paths.', min: 1, max: 8 },
  { key: 'layerDifference', label: 'Layer difference', help: 'Sets how different colors must be before separate color layers are created. Higher values merge similar colors; lower values create more layers.', min: 0, max: 255 },
];
const MAX_PIXELS = 64_000_000;

function PreviewSurface({ src, alt, checkerboard = false, background }: { src: string; alt: string; checkerboard?: boolean; background?: string }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const surface = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };
  const changeZoom = (factor: number) => setZoom((value) => Math.min(8, Math.max(0.1, Number((value * factor).toFixed(3)))));
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); changeZoom(event.deltaY < 0 ? 1.05 : 1 / 1.05); };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  return <>
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={() => changeZoom(1 / 1.1)} className="rounded border px-3 py-1 font-semibold">Zoom out</button>
      <span className="min-w-16 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => changeZoom(1.1)} className="rounded border px-3 py-1 font-semibold">Zoom in</button>
      <button type="button" onClick={reset} className="rounded border px-3 py-1 font-semibold">Fit view</button>
      <button type="button" onClick={reset} className="rounded border px-3 py-1 font-semibold">Reset view</button>
      <span className="text-xs text-gray-500">Mouse wheel zooms in 5% steps; drag to pan.</span>
    </div>
    <div
      className={`flex h-[min(65vh,650px)] min-h-[360px] items-center justify-center overflow-hidden rounded p-3 touch-none ${checkerboard ? 'bg-[radial-gradient(#d1d5db_1px,transparent_1px)] bg-[length:16px_16px]' : 'bg-gray-100'}`}
      style={background ? { backgroundColor: background, backgroundImage: 'none' } : undefined}
      ref={surface}
      onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (drag.current) setOffset({ x: drag.current.startX + event.clientX - drag.current.x, y: drag.current.startY + event.clientY - drag.current.y }); }}
      onPointerUp={() => { drag.current = null; }}
    >
      <img src={src} alt={alt} draggable={false} className="max-h-[58vh] max-w-full select-none object-contain" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: 'center', cursor: drag.current ? 'grabbing' : 'grab' }} />
    </div>
  </>;
}

function StageHeader({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle(): void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-bold">{title}</h2>
      <button type="button" onClick={onToggle} aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`} className="rounded border px-2 py-1 text-sm font-semibold">{expanded ? '▲' : '▼'}</button>
    </div>
  );
}

export default function ArtworkPreviewTunePage() {
  const artworkId = useParams<{ artworkId: string }>().artworkId;
  const router = useRouter();
  const [versions, setVersions] = useState<RasterChoice[]>([]);
  const [selected, setSelected] = useState('');
  const [original, setOriginal] = useState<RasterChoice | null>(null);
  const [artworkName, setArtworkName] = useState('');
  const [settings, setSettings] = useState<TuneSettings>(DEFAULT_SETTINGS);
  const [upscaleFactor, setUpscaleFactor] = useState(1);
  const [reviewStatus, setReviewStatus] = useState<'APPROVED' | 'NEEDS_VECTOR_EDIT'>('APPROVED');
  const [vectorCandidateId, setVectorCandidateId] = useState<string | null>(null);
  const [vectorView, setVectorView] = useState<PreviewKind>('jpg');
  const [pngBackground, setPngBackground] = useState('#ffffff');
  const [savedOutputs, setSavedOutputs] = useState<SavedOutputs>({ svg: false, png: false, jpg: false });
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vectorGenerating, setVectorGenerating] = useState(false);
  const [revision, setRevision] = useState(Date.now());
  const [outputFormats, setOutputFormats] = useState<Array<'JPG' | 'PNG' | 'PNG_MASK' | 'PDF'>>([]);
  const [recreateSvg, setRecreateSvg] = useState(false);
  const [imageWidth, setImageWidth] = useState(0);
  const [resizePercent, setResizePercent] = useState(100);
  const [resizeMode, setResizeMode] = useState<'PERCENT' | 'ABSOLUTE'>('ABSOLUTE');
  const [maintainAspect, setMaintainAspect] = useState(true);
  const [imageUnit, setImageUnit] = useState<'IN' | 'CM'>('IN');
  const [canvasUnit, setCanvasUnit] = useState<'IN' | 'CM'>('IN');
  const [imageHeight, setImageHeight] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [imageDpi, setImageDpi] = useState(300);
  const [canvasDpi, setCanvasDpi] = useState(300);
  const [expandedStage, setExpandedStage] = useState<'working' | 'prepare' | 'outputs' | 'vectorizer' | null>('working');
  const [canvasFill, setCanvasFill] = useState<'WHITE' | 'BLACK'>('WHITE');
  const [canvasAnchor, setCanvasAnchor] = useState<'TOP_LEFT' | 'TOP' | 'TOP_RIGHT' | 'LEFT' | 'CENTER' | 'RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM' | 'BOTTOM_RIGHT'>('CENTER');
  const [availableOutputs, setAvailableOutputs] = useState<Array<{ format: string; filePath: string }>>([]);
  const [presets, setPresets] = useState<ControlPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const controlsLoaded = useRef(false);

  const invalidateVector = () => setVectorCandidateId(null);
  const update = <K extends keyof TuneSettings>(key: K, value: TuneSettings[K]) => { setSettings((old) => ({ ...old, [key]: value })); invalidateVector(); };
  async function loadVersions(preserve = false) {
    const response = await fetch(`/api/artwork/${artworkId}/raster-versions`, { cache: 'no-store' }); const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load working versions');
    const available = data.versions || []; setVersions(available); setOriginal(data.original || null); setArtworkName(typeof data.artworkName === 'string' ? data.artworkName : ''); setSavedOutputs(data.savedOutputs || { svg: false, png: false, jpg: false });
    setAvailableOutputs(data.rasterOutputs || []);
    if (!preserve || ![data.original?.key, ...available.map((item: RasterChoice) => item.key)].includes(selected)) setSelected(available.find((item: RasterChoice) => item.isCurrent)?.key || data.original?.key || '');
  }
  const refresh = async (announce = true) => { try { await loadVersions(true); setRevision(Date.now()); if (announce) setNotice('Working image refreshed from disk.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to refresh image'); } };
  useEffect(() => { void loadVersions().catch((error) => setNotice(error.message)); }, [artworkId]);
  useEffect(() => { const handler = () => void refresh(false); window.addEventListener('focus', handler); return () => window.removeEventListener('focus', handler); });
  useEffect(() => {
    const stored = window.localStorage.getItem('vectorforge.preview.binaryTraceColor');
    if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) setSettings((current) => ({ ...current, binaryTraceColor: stored }));
  }, []);
  useEffect(() => { window.localStorage.setItem('vectorforge.preview.binaryTraceColor', settings.binaryTraceColor); }, [settings.binaryTraceColor]);
  useEffect(() => {
    const stored = Number(window.localStorage.getItem('vectorforge.preview.traceThicknessPx'));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 20) setSettings((current) => ({ ...current, traceThicknessPx: stored }));
  }, []);
  useEffect(() => { window.localStorage.setItem('vectorforge.preview.traceThicknessPx', String(settings.traceThicknessPx)); }, [settings.traceThicknessPx]);
  useEffect(() => { const stored = window.localStorage.getItem('vectorforge.preview.pngBackground'); if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) setPngBackground(stored); }, []);
  useEffect(() => { window.localStorage.setItem('vectorforge.preview.pngBackground', pngBackground); }, [pngBackground]);
  useEffect(() => {
    fetch('/api/control-presets', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load control presets');
      setPresets(data.presets || []);
      if (data.lastSettings) setSettings((current) => ({ ...current, ...data.lastSettings }));
      if (data.rasterPreparation) {
        setSettings((current) => ({ ...current, blur: Number(data.rasterPreparation.blur) || 0 }));
        setUpscaleFactor(Number(data.rasterPreparation.upscaleFactor) || 1);
      }
      controlsLoaded.current = true;
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Unable to load control presets'));
  }, []);
  useEffect(() => {
    if (!controlsLoaded.current) return;
    const timer = window.setTimeout(() => {
      fetch('/api/control-presets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'persist-current', settings, rasterPreparation: { blur: settings.blur, upscaleFactor } }) }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [settings, upscaleFactor]);

  const choice = useMemo(() => selected === 'original' ? original : versions.find((item) => item.key === selected) ?? null, [original, selected, versions]);
  const setImageDimension = (axis: 'width' | 'height', value: number) => { if (!Number.isFinite(value) || value <= 0) return; const ratio = width && height ? width / height : imageWidth / imageHeight; const rounded = Math.max(1, Math.round(value)); if (axis === 'width') { setImageWidth(rounded); if (maintainAspect && ratio) setImageHeight(Math.max(1, Math.round(rounded / ratio))); } else { setImageHeight(rounded); if (maintainAspect && ratio) setImageWidth(Math.max(1, Math.round(rounded * ratio))); } };
  const applyPercentResize = (percent: number) => { setResizePercent(percent); if (!width || !height || !Number.isFinite(percent) || percent <= 0) return; setImageWidth(Math.max(1, Math.round(width * percent / 100))); setImageHeight(Math.max(1, Math.round(height * percent / 100))); };
  const selectedFilename = choice?.filePath.split(/[\\/]/).pop() || 'No working image selected';
  const artworkFilename = artworkName || original?.filePath.split(/[\\/]/).pop() || selectedFilename;
  const width = choice?.width ?? 0; const height = choice?.height ?? 0; const outputWidth = imageWidth; const outputHeight = imageHeight; const outputPixels = outputWidth * outputHeight;
  const tooLarge = outputPixels > MAX_PIXELS; const blocked = busy || !selected || tooLarge;
  useEffect(() => { if (width && height) { setImageWidth(width); setImageHeight(height); setCanvasWidth(width); setCanvasHeight(height); setImageDpi(300); setCanvasDpi(300); setImageUnit('IN'); setCanvasUnit('IN'); setResizePercent(100); setResizeMode('ABSOLUTE'); } }, [width, height]);
  const rasterUrl = selected === 'original' ? `/api/artwork/${artworkId}/preview?variant=original&v=${revision}` : `/api/artwork/${artworkId}/preview?versionKey=${encodeURIComponent(selected)}&v=${revision}`;
  const workingJpegUrl = `/api/artwork/${artworkId}/preview?v=${revision}`;
  const workingPngUrl = `/api/artwork/${artworkId}/preview?variant=working-png&v=${revision}`;
  const outputPngUrl = `/api/artwork/${artworkId}/preview?variant=output-png&v=${revision}`;
  const outputPngMaskUrl = `/api/artwork/${artworkId}/preview?variant=output-png-mask&v=${revision}`;
  const outputPdfUrl = `/api/artwork/${artworkId}/preview?variant=output-pdf&v=${revision}`;
  const vectorSvgUrl = vectorCandidateId ? `/api/artwork/${artworkId}/vector-preview?candidateId=${encodeURIComponent(vectorCandidateId)}&v=${revision}` : null;
  const reviewAssets: Array<{ kind: PreviewKind; label: string; exists: boolean; format?: 'SVG' | 'JPG' | 'PNG' | 'PNG_MASK' | 'PDF' }> = [
    { kind: 'svg', label: 'SVG', exists: Boolean(vectorSvgUrl), format: 'SVG' },
    { kind: 'png', label: 'PNG', exists: availableOutputs.some((output) => output.format === 'PNG'), format: 'PNG' },
    { kind: 'pngMask', label: 'PNG Mask', exists: availableOutputs.some((output) => output.format === 'PNG_MASK'), format: 'PNG_MASK' },
    { kind: 'jpg', label: 'JPG', exists: Boolean(choice?.filePath), format: 'JPG' },
    { kind: 'pdf', label: 'PDF', exists: availableOutputs.some((output) => output.format === 'PDF'), format: 'PDF' },
  ];
  const reviewedAsset = reviewAssets.find((asset) => asset.kind === vectorView) ?? { kind: 'jpg' as const, label: 'JPG', exists: Boolean(choice?.filePath), format: 'JPG' as const };
  const hasSelectedImageFormats = outputFormats.length > 0 || recreateSvg;
  const rasterOutputDimensionsValid = canvasWidth > 0 && canvasHeight > 0 && canvasDpi > 0;
  const canCreateSelectedImages = hasSelectedImageFormats && (recreateSvg || rasterOutputDimensionsValid);

  async function activate() { setBusy(true); try { const response = await fetch(`/api/artwork/${artworkId}/raster-versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionKey: selected }) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to select version'); setNotice('Selected working version is now active.'); setExpandedStage('prepare'); await refresh(false); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to select version'); } finally { setBusy(false); } }
  async function prepareWorkingJpeg() {
    if (canvasWidth < imageWidth || canvasHeight < imageHeight) {
      const continueWithClip = window.confirm('The canvas is smaller than the resized image, so part of the image will be clipped at the selected anchor. Choose OK to continue with clipping, or Cancel to adjust the canvas.');
      if (!continueWithClip) return false;
    }
    const response = await fetch(`/api/artwork/${artworkId}/prepare-layout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: { blur: settings.blur, imageWidth, imageHeight, canvasWidth, canvasHeight, imageDpi, canvasDpi, fill: canvasFill, anchor: canvasAnchor } }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Unable to prepare the working JPG');
    await refresh(false);
    return true;
  }
  async function openWorkingJpg() {
    setBusy(true); try { const response = await fetch('/api/local-editor/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'original-raster', artworkId, prepare: false }) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to open JPG'); setNotice('Opened the currently viewed JPG in the assigned editor.'); } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to open JPG'); } finally { setBusy(false); }
  }
  async function openGeneratedOutput(outputType: 'JPG' | 'PNG' | 'PNG_MASK') {
    setBusy(true); try {
      const response = await fetch('/api/local-editor/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'direct-output-raster', artworkId, outputType }) });
      const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to open output');
      setNotice(`Opened ${outputType === 'PNG_MASK' ? 'PNG Mask' : outputType} output in the raster editor.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to open output'); } finally { setBusy(false); }
  }
  async function editReviewedImage() {
    if (vectorView === 'jpg') return openWorkingJpg();
    if (vectorView === 'png') return openGeneratedOutput('PNG');
    if (vectorView === 'pngMask') return openGeneratedOutput('PNG_MASK');
    if (vectorView === 'pdf') { window.open(outputPdfUrl, '_blank', 'noopener,noreferrer'); return; }
    if (vectorView === 'svg' && savedOutputs.svg) return openVector();
    setNotice('Save the vector result before opening the SVG in the assigned editor.');
  }
  async function exportSelectedFormats() {
    const formats = [...outputFormats, ...(recreateSvg ? ['SVG'] : [])];
    if (formats.length === 0) {
      setActionError('Check at least one image format to export.');
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/artwork/${artworkId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formats }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to export files');
      if (data.cancelled) setNotice('Export cancelled.');
      else setNotice(`Exported ${data.files.length} file${data.files.length === 1 ? '' : 's'} to ${data.directory}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to export files');
    } finally {
      setBusy(false);
    }
  }
  async function openOutputFolder() { setBusy(true); try { const response = await fetch('/api/local-editor/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'direct-output-folder', artworkId }) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to open output folder'); setNotice('Opened the output folder.'); } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to open output folder'); } finally { setBusy(false); } }

  async function generateVector() { if (tooLarge) return; setBusy(true); setVectorGenerating(true); try { const response = await fetch(`/api/artwork/${artworkId}/vector-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, upscaleFactor }) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to generate vector preview'); setVectorCandidateId(data.candidateId); setVectorView('svg'); setNotice(`Vector preview generated with ${data.diagnostics?.pathCount ?? 'the'} traced path${data.diagnostics?.pathCount === 1 ? '' : 's'}.`); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to generate vector preview'); } finally { setVectorGenerating(false); setBusy(false); } }
  async function approve() { if (!vectorCandidateId) return setNotice('Generate a vector preview first.'); setBusy(true); try { const response = await fetch(`/api/artwork/${artworkId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, upscaleFactor, candidateId: vectorCandidateId, reviewStatus }) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save vector output'); router.push('/dashboard'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to save vector output'); } finally { setBusy(false); } }
  async function openVector() { setBusy(true); try { const response = await fetch('/api/local-editor/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'direct-vector', artworkId }) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to open vector editor'); setNotice('Opened the saved SVG in the vector editor.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to open vector editor'); } finally { setBusy(false); } }

  async function exportRasterOutputs() {
    setActionError(null);
    if (!hasSelectedImageFormats) { setActionError('Check at least one image format first. A checked box means create or recreate that format.'); return; }
    if (outputFormats.length > 0 && !rasterOutputDimensionsValid) { setActionError('Enter valid canvas width, height, and resolution before creating JPG, PNG, PNG Mask, or PDF output.'); return; }
    if (tooLarge) { setActionError('The resized image exceeds the 64 MP limit. Choose smaller image dimensions before creating output.'); return; }
    setNotice('Preparing the working JPG and creating the checked image formats…'); setBusy(true);
    try {
      const prepared = await prepareWorkingJpeg(); if (!prepared) return;
      const created: string[] = []; let dimensions: { width: number; height: number } | undefined;
      if (outputFormats.length > 0) {
        const response = await fetch(`/api/artwork/${artworkId}/output`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export-raster', specification: { constrainBy: 'WIDTH', value: canvasWidth / canvasDpi, unit: 'IN', dpi: canvasDpi, formats: outputFormats } }) });
        const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to create output files');
        dimensions = data.result?.dimensions; created.push(...data.result.assets.map((asset: { format: string }) => asset.format));
      }
      if (recreateSvg) {
        setVectorGenerating(true);
        try {
          const response = await fetch(`/api/artwork/${artworkId}/vector-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, upscaleFactor }) });
          const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to create SVG preview');
          setVectorCandidateId(data.candidateId); setVectorView('svg'); created.push('SVG preview');
        } finally {
          setVectorGenerating(false);
        }
      }
      await refresh(false); setExpandedStage('vectorizer');
      setNotice(`Created ${created.join(', ')}${dimensions ? ` at ${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()} px` : ''}.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to create output files'); } finally { setBusy(false); }
  }
  const toggleOutputFormat = (format: 'JPG' | 'PNG' | 'PNG_MASK' | 'PDF') => setOutputFormats((current) => current.includes(format) ? current.filter((value) => value !== format) : [...current, format]);

  async function savePreset() { if (!presetName.trim()) return setNotice('Enter a preset name.'); setBusy(true); try { const response = await fetch('/api/control-presets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-preset', name: presetName.trim(), description: presetDescription.trim(), settings, rasterPreparation: { blur: settings.blur, upscaleFactor } }) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save preset'); setPresets(data.presets || []); setPresetDialogOpen(false); setPresetName(''); setPresetDescription(''); setNotice('Vectorizer preset saved.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to save preset'); } finally { setBusy(false); } }
  async function applyPreset(id: string) { const preset = presets.find((item) => item.id === id); if (!preset) return; setBusy(true); try { const response = await fetch('/api/control-presets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'use-preset', id }) }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Unable to use preset'); setSettings((current) => ({ ...current, ...preset.settings })); setUpscaleFactor(preset.rasterPreparation.upscaleFactor); setSelectedPresetId(id); invalidateVector(); setNotice(`Applied preset: ${preset.name}.`); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to use preset'); } finally { setBusy(false); } }

  return <div className="mx-auto max-w-7xl">
    <header className="mb-5 flex items-center justify-between"><div><h1 className="text-2xl font-bold">Prepare / Vectorize Artwork</h1><p className="mt-1 text-sm text-gray-700"><strong>Artwork name:</strong> {artworkFilename}</p><p className="text-sm text-gray-600"><strong>Editing now:</strong> {selectedFilename}</p><p className="mt-1 text-sm text-gray-600">Set the resize, canvas, and vectorizer controls; then create or recreate the checked image formats from a fresh prepared working JPG.</p></div><Link href="/dashboard" className="rounded border px-3 py-2 text-sm font-semibold">Back to Dashboard</Link></header>
    {notice && <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</div>}
    {actionError && <div role="alert" className="mb-4 rounded border-2 border-red-400 bg-red-50 p-3 text-sm font-semibold text-red-900">Artwork action failed: {actionError}</div>}
    <main className="grid gap-6 xl:grid-cols-[1fr_380px]"><div className="space-y-6">
      <section className="rounded-xl border bg-white p-4"><div className="mb-3 flex items-center justify-between gap-3"><strong>Selected working image: {width && height ? `${width.toLocaleString()} × ${height.toLocaleString()} px` : 'Dimensions unavailable'}</strong><button onClick={() => void refresh()} disabled={busy} className="rounded border px-3 py-1 text-sm">Refresh image</button></div>
        <div className="rounded-xl border border-emerald-300 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Image Review — {reviewedAsset.label}</h2><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || (vectorView === 'svg' && !savedOutputs.svg)} onClick={() => void editReviewedImage()} title={vectorView === 'svg' && !savedOutputs.svg ? 'Save the vector result before opening its editor.' : vectorView === 'pdf' ? 'Open the reviewed PDF in a new browser tab.' : 'Open the currently reviewed image in its assigned editor.'} className="rounded bg-sky-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Edit</button><button type="button" disabled={busy} onClick={() => void exportRasterOutputs()} title={canCreateSelectedImages ? 'Create new versions of the checked formats. Raster formats use the prepared canvas size and DPI; SVG uses the current vectorizer controls.' : 'Click to see what is still required before selected images can be created.'} className="rounded bg-sky-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Create Selected Images</button><button type="button" disabled={busy} onClick={() => void exportSelectedFormats()} title="Open a folder selector and copy the checked, available file formats to that folder. The last selected folder is remembered." className="rounded border px-4 py-2 font-semibold disabled:opacity-50">Export Selected</button><button type="button" disabled={busy || availableOutputs.length === 0} onClick={() => void openOutputFolder()} title={availableOutputs.length === 0 ? 'Create at least one raster output file first.' : 'Open this artwork’s VectorForge output folder in Windows Explorer.'} className="rounded border px-4 py-2 font-semibold disabled:opacity-50">Open Output Folder</button></div></div>
          <div className="mb-5 flex flex-wrap gap-2">{reviewAssets.map((asset) => { const selectedReview = asset.kind === vectorView; const selectedForCreation = asset.format === 'SVG' ? recreateSvg : asset.format ? outputFormats.includes(asset.format) : false; const className = selectedReview && asset.exists ? 'bg-blue-500 text-white border-blue-500' : asset.exists ? 'bg-gray-400 text-gray-950 border-gray-400' : 'bg-white text-gray-950 border-gray-300'; const toggleCreation = () => { if (asset.format === 'SVG') setRecreateSvg((current) => !current); else if (asset.format) toggleOutputFormat(asset.format); }; const selectOrView = () => { if (asset.exists) setVectorView(asset.kind); else toggleCreation(); }; return <div key={asset.kind} className={`relative flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-semibold ${className}`}><input type="checkbox" aria-label={asset.exists ? `Recreate ${asset.label}` : `Create ${asset.label}`} checked={selectedForCreation} disabled={!asset.format || vectorGenerating} onChange={toggleCreation} /><button type="button" disabled={(!asset.exists && !asset.format) || vectorGenerating} onClick={selectOrView} className="disabled:cursor-default">{asset.label}</button>{asset.kind === 'svg' && vectorGenerating && <span aria-label="Generating SVG" title="Generating SVG preview…" className="absolute inset-0 flex items-center justify-center rounded bg-blue-600/90 text-white"><span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />Generating…</span>}</div>; })}</div>
          {(vectorView === 'png' || vectorView === 'pngMask') && <label className="mb-3 flex items-center gap-2 text-sm font-semibold">Review background <input type="color" value={pngBackground} onChange={(event) => setPngBackground(event.target.value)} className="h-8 w-12 rounded border p-1" /></label>}
          {vectorView === 'svg' && vectorSvgUrl ? <PreviewSurface key={`${vectorCandidateId}-svg`} src={vectorSvgUrl} alt="Vector preview" checkerboard /> : vectorView === 'png' ? <PreviewSurface key={`${revision}-output-png`} src={outputPngUrl} alt="Generated PNG" background={pngBackground} /> : vectorView === 'pngMask' ? <PreviewSurface key={`${revision}-output-png-mask`} src={outputPngMaskUrl} alt="Generated PNG mask" background={pngBackground} /> : vectorView === 'pdf' ? <iframe key={`${revision}-output-pdf`} src={outputPdfUrl} title="Generated PDF" className="h-[min(65vh,650px)] min-h-[360px] w-full rounded border" /> : <PreviewSurface key={`${revision}-jpg`} src={workingJpegUrl} alt="Working JPG" />}
          <p className="mt-3 text-xs text-gray-500">Gray buttons are existing images; blue is the image being viewed. White buttons are not created yet; their checkboxes select them for creation. PNG review backgrounds are never saved into the image.</p>
        </div>
      </section>
    </div><aside className="space-y-4 rounded-xl border bg-white p-4">
      <section title="Choose which saved raster version is the current working JPG."><StageHeader title="1. Working JPG" expanded={expandedStage === 'working'} onToggle={() => setExpandedStage((current) => current === 'working' ? null : 'working')} />{expandedStage === 'working' && <><select value={selected} onChange={(event) => { setSelected(event.target.value); invalidateVector(); setRevision(Date.now()); }} title="Select an existing working version or the protected original to start a new JPG." className="mt-2 w-full rounded border p-2">{original && <option value={original.key}>{original.label} · starts a fresh JPG</option>}{versions.map((item) => <option key={item.key} value={item.key}>Working JPG version {item.versionNumber}{item.isCurrent ? ' (current)' : ''} · {item.width} × {item.height}</option>)}</select><button disabled={busy || !selected} onClick={activate} title="Make this version the persistent current working image." className="mt-2 w-full rounded border px-3 py-2 font-semibold disabled:opacity-50">Use Selected Working Image</button></>}</section>
      <section className="border-t pt-4"><StageHeader title="2. Prepare working JPG" expanded={expandedStage === 'prepare'} onToggle={() => setExpandedStage((current) => current === 'prepare' ? null : 'prepare')} />{expandedStage === 'prepare' && <><p className="text-xs text-gray-600">Resize the image itself, then set the final canvas. These settings are applied automatically when you choose Create Selected Images.</p><label title="Softens raster noise before resizing. Use a low value for scans; a high value can erase small details." className="mt-3 block text-sm font-semibold">Smooth raster: {settings.blur}<input type="range" min="0" max="20" step="0.1" value={settings.blur} onChange={(event) => update('blur', Number(event.target.value))} className="mt-1 w-full" /></label><RasterLayoutControls resizeMode={resizeMode} imageUnit={imageUnit} canvasUnit={canvasUnit} imageWidth={imageWidth} imageHeight={imageHeight} imageDpi={imageDpi} canvasWidth={canvasWidth} canvasHeight={canvasHeight} canvasDpi={canvasDpi} percent={resizePercent} maintainAspect={maintainAspect} fill={canvasFill} anchor={canvasAnchor} onResizeMode={setResizeMode} onImageUnit={setImageUnit} onCanvasUnit={setCanvasUnit} onImageWidth={(value) => setImageDimension('width', value)} onImageHeight={(value) => setImageDimension('height', value)} onImageDpi={(value) => setImageDpi(Math.max(1, Math.round(value)))} onCanvasWidth={(value) => setCanvasWidth(Math.max(1, Math.round(value)))} onCanvasHeight={(value) => setCanvasHeight(Math.max(1, Math.round(value)))} onCanvasDpi={(value) => setCanvasDpi(Math.max(1, Math.round(value)))} onPercent={applyPercentResize} onMaintainAspect={setMaintainAspect} onFill={setCanvasFill} onAnchor={setCanvasAnchor} /><p className="mt-3 text-xs text-gray-600">Prepared JPG canvas: {canvasWidth && canvasHeight ? `${canvasWidth.toLocaleString()} × ${canvasHeight.toLocaleString()} px at ${canvasDpi} DPI` : 'Select a raster version to calculate size'}</p>{tooLarge && <p className="mt-2 text-sm font-semibold text-red-700">This resized image exceeds the 64 MP limit. Choose smaller image dimensions before creating output.</p>}</>}</section>
      <section className="border-t pt-4"><StageHeader title="3. Output files" expanded={expandedStage === 'outputs'} onToggle={() => setExpandedStage((current) => current === 'outputs' ? null : 'outputs')} />{expandedStage === 'outputs' && <p className="mt-1 text-xs text-gray-600">Check the image formats to create or recreate in the Image Review panel, then choose <strong>Create Selected Images</strong>. The Output Folder button appears above the preview.</p>}</section>
      <section className="border-t pt-4"><StageHeader title="4. Vectorizer tuning" expanded={expandedStage === 'vectorizer'} onToggle={() => setExpandedStage((current) => current === 'vectorizer' ? null : 'vectorizer')} />{expandedStage === 'vectorizer' && <><section className="mb-4 rounded border bg-gray-50 p-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Control presets</h3><button type="button" onClick={() => setPresetDialogOpen(true)} title="Save the current vectorizer controls with a name and description." className="rounded border bg-white px-2 py-1 text-xs font-semibold">Save Set</button></div><select value={selectedPresetId} onChange={(event) => void applyPreset(event.target.value)} title={presets.find((preset) => preset.id === selectedPresetId)?.description || 'Select a named set of vectorizer controls.'} className="mt-2 w-full rounded border p-2 text-sm"><option value="">Choose a saved preset…</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}{preset.description ? ` — ${preset.description}` : ''}</option>)}</select>{presets.length === 0 ? <p className="mt-2 text-xs text-gray-500">Save a set after adjusting the vectorizer controls below.</p> : <div className="mt-2 space-y-1">{presets.map((preset) => <button key={preset.id} type="button" title={preset.description || 'No description supplied.'} onClick={() => void applyPreset(preset.id)} className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-white ${selectedPresetId === preset.id ? 'bg-blue-50 font-semibold' : ''}`}>{preset.name}<span className="ml-1 text-gray-500">{preset.description || 'No description'}</span></button>)}</div>}</section><label title="Single color produces one clean color and is usually best for line art. Color mode retains multiple source colors but can create many more paths." className="block text-sm font-semibold">Color mode<select value={settings.colorMode} onChange={(event) => update('colorMode', event.target.value as TuneSettings['colorMode'])} className="mt-1 w-full rounded border p-2"><option value="binary">Single color</option><option value="color">Color</option></select></label>{settings.colorMode === 'binary' && <><label title="Sets the fill and stroke color of a single-color vector trace. It changes the SVG appearance, not the JPG used for tracing." className="mt-3 flex items-center justify-between text-sm font-semibold">Trace color<input type="color" value={settings.binaryTraceColor} onChange={(event) => update('binaryTraceColor', event.target.value)} className="h-9 w-14 rounded border p-1" /></label><label title="Adds visible width to the single-color vector paths. Use a small value to make thin traced lines easier to see; too much can close small gaps." className="mt-3 block text-sm font-semibold">Trace thickness: {settings.traceThicknessPx}px<input type="range" min="0" max="20" step="0.5" value={settings.traceThicknessPx} onChange={(event) => update('traceThicknessPx', Number(event.target.value))} className="mt-1 w-full" /></label></>}<div className="mt-3 space-y-3">{TUNERS.map((tuner) => <label key={tuner.key} title={tuner.help} className="block text-sm font-semibold">{tuner.label}: {settings[tuner.key]}<input type="range" min={tuner.min} max={tuner.max} step={tuner.step ?? 1} value={settings[tuner.key]} onChange={(event) => update(tuner.key, Number(event.target.value))} className="mt-1 w-full" /></label>)}</div><button disabled={blocked} onClick={generateVector} title="Traces the current prepared JPG using the current controls. It creates a review preview only; it does not save approved outputs yet." className="w-full rounded bg-violet-600 px-3 py-2 font-semibold text-white disabled:opacity-50">Generate Vector Preview</button><section className="border-t pt-4"><label title="Approved makes the saved SVG/PNG/JPG available in Completed Vector Artwork for other applications. Needs Vector Edit saves the outputs but keeps the artwork in the active workspace for further SVG work." className="block text-sm font-semibold">Vector result<select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as 'APPROVED' | 'NEEDS_VECTOR_EDIT')} className="mt-1 w-full rounded border p-2"><option value="APPROVED">Good — Save Vector Outputs</option><option value="NEEDS_VECTOR_EDIT">Needs Vector Edit</option></select></label><button disabled={busy || !vectorCandidateId} onClick={approve} title="Saves the reviewed SVG and the current JPG/PNG under the original artwork name, then returns to the dashboard. The working version name is never used for final output names." className="mt-3 w-full rounded bg-emerald-600 px-3 py-2 font-semibold text-white disabled:opacity-50">Save / Mark Vector Result</button><p className="mt-3 text-xs text-gray-600">Saved outputs: SVG {savedOutputs.svg ? 'available' : 'not saved'} · PNG {savedOutputs.png ? 'available' : 'not saved'} · JPG {savedOutputs.jpg ? 'available' : 'not saved'}</p></section></>}</section>
    </aside></main>
    {presetDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl"><h2 className="font-bold">Save control setting preset</h2><p className="mt-1 text-sm text-gray-600">Save the current raster preparation and vectorizer settings with a name and description.</p><label className="mt-4 block text-sm font-semibold">Name<input autoFocus value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="For example: Clean black line art" className="mt-1 w-full rounded border p-2" /></label><label className="mt-3 block text-sm font-semibold">Description<textarea value={presetDescription} onChange={(event) => setPresetDescription(event.target.value)} placeholder="What images this works best for and why" className="mt-1 min-h-24 w-full rounded border p-2" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setPresetDialogOpen(false)} className="rounded border px-3 py-2">Cancel</button><button type="button" disabled={busy || !presetName.trim()} onClick={() => void savePreset()} className="rounded bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50">Save Set</button></div></div></div>}
  </div>;
}
