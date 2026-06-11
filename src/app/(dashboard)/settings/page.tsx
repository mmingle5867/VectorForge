'use client';

import { useState, useEffect, useCallback } from 'react';
import SubstitutionTable, {
  type SubstitutionRow,
  objectToRows,
  rowsToObject,
} from '@/components/substitution-table';
import {
  FACTORY_TUNING_EXPORT_DEFAULTS,
  RECOMMENDED_SMOOTH_TUNING_EXPORT_DEFAULTS,
  TUNING_EXPORT_HELP,
  TUNING_EXPORT_RANGES,
  type TuningExportSettingKey,
  type TuningExportSettings,
} from '@/lib/tuning-defaults';

// ============================================================================
// Types
// ============================================================================

interface UserSettings extends TuningExportSettings {
  defaultUpscaleFactor: number;
  smartUpscaleThreshold: number;
  baseAssetsPath: string;
  outputPath: string;
  defaultSubstitutions: Record<string, string>;
  // Marketplace Preview
  enableMarketplacePreview: boolean;
  enableColorTint: boolean;
  tintColor: string;
  watermarkOpacity: number;
  backgroundFilename: string;
  watermarkFilename: string;
  // CNC Mode
  cncMode: boolean;
}

interface PathTestResult {
  path: string;
  exists: boolean;
  writable: boolean;
  error?: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  defaultUpscaleFactor: 2,
  smartUpscaleThreshold: 2000,
  baseAssetsPath: './base-assets',
  outputPath: './output',
  defaultSubstitutions: {},
  enableMarketplacePreview: true,
  enableColorTint: false,
  tintColor: '#FFFFFF',
  watermarkOpacity: 80,
  backgroundFilename: 'preview-background.jpg',
  watermarkFilename: 'watermark.png',
  cncMode: true,
  ...FACTORY_TUNING_EXPORT_DEFAULTS,
};

// ============================================================================
// Tooltip Component
// ============================================================================

function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  const [show, setShow] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="cursor-help"
      >
        {children}
      </span>
      {show && (
        <span className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-gray-700">
          {content}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
        </span>
      )}
    </span>
  );
}

function InfoIcon() {
  return (
    <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ============================================================================
// Path Validation
// ============================================================================

function validatePath(p: string): { valid: boolean; message: string } {
  if (!p || p.trim() === '') return { valid: false, message: 'Path cannot be empty' };
  if (!p.startsWith('./')) return { valid: false, message: 'Must start with ./' };
  if (p.includes('..')) return { valid: false, message: 'Cannot contain ..' };
  if (/[<>:"|?*]/.test(p)) return { valid: false, message: 'Contains invalid characters' };
  return { valid: true, message: 'Valid path' };
}

function PathIndicator({ path }: { path: string }) {
  const { valid, message } = validatePath(path);
  return (
    <span className={`ml-2 inline-flex items-center gap-1 text-xs ${valid ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
      {valid ? (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      {message}
    </span>
  );
}

// ============================================================================
// Toggle Switch Component
// ============================================================================

function ToggleSwitch({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
        enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
      }`}
    >
      {label && <span className="sr-only">{label}</span>}
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

const PREPROCESSING_CONTROLS: Array<{ key: TuningExportSettingKey; label: string }> = [
  { key: 'preUpscaleBlur', label: 'Pre-Upscale Blur' },
  { key: 'preprocessingBlur', label: 'Preprocessing Blur' },
  { key: 'blurPasses', label: 'Blur Passes' },
  { key: 'edgePaddingPx', label: 'Edge Padding' },
];

const VTRACER_CONTROLS: Array<{ key: TuningExportSettingKey; label: string }> = [
  { key: 'pathPrecision', label: 'Path Precision' },
  { key: 'cornerThreshold', label: 'Corner Threshold' },
  { key: 'filterSpeckle', label: 'Filter Speckle' },
  { key: 'lengthThreshold', label: 'Length Threshold' },
  { key: 'spliceThreshold', label: 'Splice Threshold' },
  { key: 'colorPrecision', label: 'Color Precision' },
  { key: 'layerDifference', label: 'Layer Difference' },
];

const EXPORT_CONTROLS: Array<{ key: TuningExportSettingKey; label: string }> = [
  { key: 'rasterExportWidth', label: 'Raster Export Width' },
  { key: 'rasterExportHeight', label: 'Raster Export Height' },
  { key: 'pngWhiteTransparencyThreshold', label: 'PNG White Transparency Threshold' },
];

function NumberSettingControl({
  label,
  settingKey,
  value,
  onChange,
}: {
  label: string;
  settingKey: TuningExportSettingKey;
  value: number;
  onChange: (key: TuningExportSettingKey, value: number) => void;
}) {
  const range = TUNING_EXPORT_RANGES[settingKey];

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <Tooltip content={TUNING_EXPORT_HELP[settingKey]}>
          <InfoIcon />
        </Tooltip>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(e) => onChange(settingKey, Number(e.target.value))}
          className="min-w-0 flex-1 accent-blue-600"
        />
        <input
          type="number"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(e) => onChange(settingKey, Number(e.target.value))}
          className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-right text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Range: {range.min}-{range.max}
      </p>
    </div>
  );
}

// ============================================================================
// Toast Component
// ============================================================================

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
      type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {type === 'success' ? (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      {message}
    </div>
  );
}

// ============================================================================
// Onboarding Modal
// ============================================================================

function OnboardingModal({ onComplete }: { onComplete: () => void }) {
  const [creating, setCreating] = useState(false);

  const createDirs = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/settings/create-dirs', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onComplete();
      }
    } catch {
      // Handle silently
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl bg-white p-8 shadow-2xl dark:bg-gray-800">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
            <svg className="h-8 w-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Welcome to VectorForge!
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Let&apos;s configure your project folders. We&apos;ll create the standard directories for uploads, output, base assets, and logs.
          </p>
        </div>

        <div className="mt-6 space-y-2">
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
            <code className="text-xs text-gray-700 dark:text-gray-300">
              ./uploads/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← Uploaded images<br />
              ./output/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← Processed vectors<br />
              ./base-assets/&nbsp;← Template files<br />
              ./logs/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← Application logs
            </code>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={createDirs}
            disabled={creating}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating...' : '📁 Create Default Directories'}
          </button>
          <button
            onClick={onComplete}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Settings Page
// ============================================================================

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [pathResults, setPathResults] = useState<PathTestResult[]>([]);
  const [testingPaths, setTestingPaths] = useState(false);
  const [substitutions, setSubstitutions] = useState<SubstitutionRow[]>([]);

  // Debounced color picker
  const [debouncedTintColor, setDebouncedTintColor] = useState(settings.tintColor);
  const [debouncedPngArtworkColor, setDebouncedPngArtworkColor] = useState(settings.pngExportArtworkColor);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettings((s) => ({ ...s, tintColor: debouncedTintColor }));
    }, 300);
    return () => clearTimeout(timer);
  }, [debouncedTintColor]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettings((s) => ({ ...s, pngExportArtworkColor: debouncedPngArtworkColor }));
    }, 300);
    return () => clearTimeout(timer);
  }, [debouncedPngArtworkColor]);

  // Fetch settings
  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();

        if (data.success && data.settings) {
          setSettings({
            defaultUpscaleFactor: data.settings.defaultUpscaleFactor ?? 2,
            smartUpscaleThreshold: data.settings.smartUpscaleThreshold ?? 2000,
            baseAssetsPath: data.settings.baseAssetsPath ?? './base-assets',
            outputPath: data.settings.outputPath ?? './output',
            defaultSubstitutions: data.settings.defaultSubstitutions ?? {},
            enableMarketplacePreview: data.settings.enableMarketplacePreview ?? true,
            enableColorTint: data.settings.enableColorTint ?? false,
            tintColor: data.settings.tintColor ?? '#FFFFFF',
            watermarkOpacity: data.settings.watermarkOpacity ?? 80,
            backgroundFilename: data.settings.backgroundFilename ?? 'preview-background.jpg',
            watermarkFilename: data.settings.watermarkFilename ?? 'watermark.png',
            cncMode: data.settings.cncMode ?? true,
            preUpscaleBlur: data.settings.preUpscaleBlur ?? FACTORY_TUNING_EXPORT_DEFAULTS.preUpscaleBlur,
            preprocessingBlur: data.settings.preprocessingBlur ?? FACTORY_TUNING_EXPORT_DEFAULTS.preprocessingBlur,
            blurPasses: data.settings.blurPasses ?? FACTORY_TUNING_EXPORT_DEFAULTS.blurPasses,
            edgePaddingPx: data.settings.edgePaddingPx ?? FACTORY_TUNING_EXPORT_DEFAULTS.edgePaddingPx,
            pathPrecision: data.settings.pathPrecision ?? FACTORY_TUNING_EXPORT_DEFAULTS.pathPrecision,
            cornerThreshold: data.settings.cornerThreshold ?? FACTORY_TUNING_EXPORT_DEFAULTS.cornerThreshold,
            filterSpeckle: data.settings.filterSpeckle ?? FACTORY_TUNING_EXPORT_DEFAULTS.filterSpeckle,
            lengthThreshold: data.settings.lengthThreshold ?? FACTORY_TUNING_EXPORT_DEFAULTS.lengthThreshold,
            spliceThreshold: data.settings.spliceThreshold ?? FACTORY_TUNING_EXPORT_DEFAULTS.spliceThreshold,
            colorPrecision: data.settings.colorPrecision ?? FACTORY_TUNING_EXPORT_DEFAULTS.colorPrecision,
            layerDifference: data.settings.layerDifference ?? FACTORY_TUNING_EXPORT_DEFAULTS.layerDifference,
            rasterExportWidth: data.settings.rasterExportWidth ?? FACTORY_TUNING_EXPORT_DEFAULTS.rasterExportWidth,
            rasterExportHeight: data.settings.rasterExportHeight ?? FACTORY_TUNING_EXPORT_DEFAULTS.rasterExportHeight,
            pngExportArtworkColor: data.settings.pngExportArtworkColor ?? FACTORY_TUNING_EXPORT_DEFAULTS.pngExportArtworkColor,
            pngWhiteTransparencyThreshold:
              data.settings.pngWhiteTransparencyThreshold ??
              FACTORY_TUNING_EXPORT_DEFAULTS.pngWhiteTransparencyThreshold,
          });
          setDebouncedTintColor(data.settings.tintColor ?? '#FFFFFF');
          setDebouncedPngArtworkColor(
            data.settings.pngExportArtworkColor ?? FACTORY_TUNING_EXPORT_DEFAULTS.pngExportArtworkColor
          );

          const subs = data.settings.defaultSubstitutions || {};
          setSubstitutions(objectToRows(subs));
        }

        if (data.isFirstTime) {
          setShowOnboarding(true);
        }
      } catch {
        setToast({ message: 'Failed to load settings', type: 'error' });
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, []);

  // Save settings
  const saveSettings = async () => {
    const basePathValid = validatePath(settings.baseAssetsPath);
    const outputPathValid = validatePath(settings.outputPath);

    if (!basePathValid.valid || !outputPathValid.valid) {
      setToast({ message: 'Please fix path errors before saving', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          defaultSubstitutions: rowsToObject(substitutions),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setToast({ message: 'Settings saved successfully', type: 'success' });
      } else {
        setToast({ message: data.error || 'Failed to save', type: 'error' });
      }
    } catch {
      setToast({ message: 'Failed to save settings', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Reset to defaults
  const resetDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
    setSubstitutions([]);
    setDebouncedTintColor('#FFFFFF');
    setDebouncedPngArtworkColor(FACTORY_TUNING_EXPORT_DEFAULTS.pngExportArtworkColor);
    setToast({ message: 'Reset to defaults (save to apply)', type: 'success' });
  };

  const updateTuningExportSetting = (key: TuningExportSettingKey, value: number) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const restoreTuningExportDefaults = (defaults: TuningExportSettings, label: string) => {
    setSettings((s) => ({ ...s, ...defaults }));
    setDebouncedPngArtworkColor(defaults.pngExportArtworkColor);
    setToast({ message: `${label} restored (save to apply)`, type: 'success' });
  };

  // Test paths
  const testPaths = async () => {
    setTestingPaths(true);
    setPathResults([]);
    try {
      const res = await fetch('/api/settings/test-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: [settings.baseAssetsPath, settings.outputPath, './uploads', './logs'],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setPathResults(data.results);
      }
    } catch {
      setToast({ message: 'Failed to test paths', type: 'error' });
    } finally {
      setTestingPaths(false);
    }
  };

  // Debounced watermark opacity handler
  const handleWatermarkOpacity = useCallback((value: number) => {
    setSettings((s) => ({ ...s, watermarkOpacity: value }));
  }, []);

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

  return (
    <div className="mx-auto max-w-3xl">
      {/* Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal onComplete={() => setShowOnboarding(false)} />
      )}

      {/* Toast */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Configure default processing options, marketplace preview, and folder paths.
        </p>
      </div>

      {/* CNC / Vinyl / Laser Mode Card */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              🔧 CNC / Vinyl / Laser Cutter Mode
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Default: Trace Only (monochrome, clean paths optimized for cutting machines)
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{settings.cncMode ? '⚡' : '🎨'}</span>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {settings.cncMode ? 'Trace Only (Monochrome)' : 'Full Color / Gradients Mode'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {settings.cncMode
                    ? 'Binary mode: clean single-color paths ideal for CNC, vinyl cutters, and laser engravers'
                    : 'Color mode: preserves gradients and multiple colors for print/digital use'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip content="Toggle between monochrome trace (CNC/vinyl/laser) and full color mode">
                <InfoIcon />
              </Tooltip>
              <ToggleSwitch
                enabled={!settings.cncMode}
                onChange={(v) => setSettings((s) => ({ ...s, cncMode: !v }))}
                label="Enable Gradients / Full Color Mode"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              {settings.cncMode
                ? 'VTracer will use binary color mode for maximum path clarity'
                : 'VTracer will preserve colors and gradients — larger SVG files'}
            </span>
          </div>
        </div>
      </div>

      {/* Marketplace Preview Card */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              🖼️ Marketplace Preview Image
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Generate a composite preview for marketplace listings
            </p>
          </div>
          <ToggleSwitch
            enabled={settings.enableMarketplacePreview}
            onChange={(v) => setSettings((s) => ({ ...s, enableMarketplacePreview: v }))}
            label="Enable Marketplace Preview"
          />
        </div>

        {settings.enableMarketplacePreview && (
          <div className="space-y-5 border-t border-gray-100 pt-4 dark:border-gray-700">
            {/* Color Tint Toggle + Picker */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable Color Tint for Preview
                  </label>
                  <Tooltip content="Apply a semi-transparent color overlay to the image before compositing onto the background">
                    <InfoIcon />
                  </Tooltip>
                </div>
                <ToggleSwitch
                  enabled={settings.enableColorTint}
                  onChange={(v) => setSettings((s) => ({ ...s, enableColorTint: v }))}
                  label="Enable Color Tint"
                />
              </div>

              {settings.enableColorTint && (
                <div className="mt-3 flex items-center gap-3">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Tint Color:</label>
                  <input
                    type="color"
                    value={debouncedTintColor}
                    onChange={(e) => setDebouncedTintColor(e.target.value)}
                    className="h-8 w-12 cursor-pointer rounded border border-gray-300 dark:border-gray-600"
                  />
                  <input
                    type="text"
                    value={debouncedTintColor}
                    onChange={(e) => setDebouncedTintColor(e.target.value)}
                    className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    placeholder="#FFFFFF"
                  />
                  <div
                    className="h-8 w-8 rounded border border-gray-300 dark:border-gray-600"
                    style={{ backgroundColor: debouncedTintColor }}
                  />
                </div>
              )}
            </div>

            {/* Watermark Opacity Slider */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Watermark Opacity
                </label>
                <Tooltip content="Controls the transparency of the watermark overlay. 0% = invisible, 100% = fully opaque">
                  <InfoIcon />
                </Tooltip>
                <span className="ml-auto text-sm font-semibold text-blue-600 dark:text-blue-400">
                  {settings.watermarkOpacity}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.watermarkOpacity}
                onChange={(e) => handleWatermarkOpacity(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0% (invisible)</span>
                <span>100% (opaque)</span>
              </div>
            </div>

            {/* Background Filename */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Background Filename
                </label>
                <Tooltip content="Image file in base-assets folder used as the preview background. Must be .jpg or .png">
                  <InfoIcon />
                </Tooltip>
              </div>
              <input
                type="text"
                value={settings.backgroundFilename}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, backgroundFilename: e.target.value }))
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                placeholder="preview-background.jpg"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Place this file in your base-assets folder: {settings.baseAssetsPath}/{settings.backgroundFilename}
              </p>
            </div>

            {/* Watermark Filename */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Watermark Filename
                </label>
                <Tooltip content="PNG image with transparency used as the watermark overlay. Placed in the center of the preview.">
                  <InfoIcon />
                </Tooltip>
              </div>
              <input
                type="text"
                value={settings.watermarkFilename}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, watermarkFilename: e.target.value }))
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                placeholder="watermark.png"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Place this file in your base-assets folder: {settings.baseAssetsPath}/{settings.watermarkFilename}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Processing Settings Card */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          Processing Defaults
        </h2>

        <div className="space-y-5">
          {/* Default Upscale Factor */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Default Upscale Factor
              </label>
              <Tooltip content="Images below the threshold will be upscaled by this factor before conversion. 1x = no upscale.">
                <InfoIcon />
              </Tooltip>
            </div>
            <select
              value={settings.defaultUpscaleFactor}
              onChange={(e) =>
                setSettings((s) => ({ ...s, defaultUpscaleFactor: Number(e.target.value) }))
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value={1}>1x — No upscaling</option>
              <option value={2}>2x — Double resolution</option>
              <option value={4}>4x — Quadruple resolution</option>
            </select>
          </div>

          {/* Smart Upscale Threshold */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Smart Upscale Threshold (px)
              </label>
              <Tooltip content="Only upscale if width OR height is below this value. Set higher to upscale more images.">
                <InfoIcon />
              </Tooltip>
            </div>
            <input
              type="number"
              min={100}
              max={10000}
              step={100}
              value={settings.smartUpscaleThreshold}
              onChange={(e) =>
                setSettings((s) => ({ ...s, smartUpscaleThreshold: Number(e.target.value) }))
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Recommended: 2000px. Range: 100–10000px.
            </p>
          </div>
        </div>
      </div>

      {/* SVG Tuning and Export Defaults Card */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              SVG Tuning and Export Defaults
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Preview/Tune uses these saved defaults now. Export settings are used by approve/save exports.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                restoreTuningExportDefaults(FACTORY_TUNING_EXPORT_DEFAULTS, 'Factory defaults')
              }
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Restore Factory Defaults
            </button>
            <button
              type="button"
              onClick={() =>
                restoreTuningExportDefaults(
                  RECOMMENDED_SMOOTH_TUNING_EXPORT_DEFAULTS,
                  'Recommended smooth defaults'
                )
              }
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
            >
              Restore Recommended Smooth Defaults
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">
              Preview/Tune Preprocessing
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {PREPROCESSING_CONTROLS.map((control) => (
                <NumberSettingControl
                  key={control.key}
                  label={control.label}
                  settingKey={control.key}
                  value={Number(settings[control.key])}
                  onChange={updateTuningExportSetting}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">
              Preview/Tune VTracer Settings
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {VTRACER_CONTROLS.map((control) => (
                <NumberSettingControl
                  key={control.key}
                  label={control.label}
                  settingKey={control.key}
                  value={Number(settings[control.key])}
                  onChange={updateTuningExportSetting}
                />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                Approve/Save Export Defaults
              </h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                These values are saved for approve/save exports; the approve/save workflow itself is unchanged in this update.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {EXPORT_CONTROLS.map((control) => (
                <NumberSettingControl
                  key={control.key}
                  label={control.label}
                  settingKey={control.key}
                  value={Number(settings[control.key])}
                  onChange={updateTuningExportSetting}
                />
              ))}

              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    PNG Artwork Color
                  </label>
                  <Tooltip content={TUNING_EXPORT_HELP.pngExportArtworkColor}>
                    <InfoIcon />
                  </Tooltip>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={debouncedPngArtworkColor}
                    onChange={(e) => setDebouncedPngArtworkColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-gray-300 dark:border-gray-600"
                  />
                  <input
                    type="text"
                    value={debouncedPngArtworkColor}
                    onChange={(e) => setDebouncedPngArtworkColor(e.target.value)}
                    className="w-28 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm font-mono text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    placeholder="#000000"
                  />
                  <div
                    className="h-9 w-9 rounded border border-gray-300 dark:border-gray-600"
                    style={{ backgroundColor: debouncedPngArtworkColor }}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Folder Paths Card */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Folder Paths
          </h2>
          <button
            onClick={testPaths}
            disabled={testingPaths}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
          >
            {testingPaths ? 'Testing...' : '🔍 Test Paths'}
          </button>
        </div>

        <div className="space-y-5">
          {/* Base Assets Path */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Base Assets Path
              </label>
              <Tooltip content="Directory containing fallback template files, preview backgrounds, and watermarks.">
                <InfoIcon />
              </Tooltip>
              <PathIndicator path={settings.baseAssetsPath} />
            </div>
            <input
              type="text"
              value={settings.baseAssetsPath}
              onChange={(e) =>
                setSettings((s) => ({ ...s, baseAssetsPath: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              placeholder="./base-assets"
            />
          </div>

          {/* Output Path */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Output Path
              </label>
              <Tooltip content="Directory where processed vector bundles (folders + ZIPs) are saved. Each batch item gets its own subfolder.">
                <InfoIcon />
              </Tooltip>
              <PathIndicator path={settings.outputPath} />
            </div>
            <input
              type="text"
              value={settings.outputPath}
              onChange={(e) =>
                setSettings((s) => ({ ...s, outputPath: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              placeholder="./output"
            />
          </div>
        </div>

        {/* Path Test Results */}
        {pathResults.length > 0 && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
            <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              Path Test Results
            </p>
            <div className="space-y-1.5">
              {pathResults.map((result) => (
                <div key={result.path} className="flex items-center gap-2 text-xs">
                  {result.exists && result.writable ? (
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
                  <code className="font-mono text-gray-700 dark:text-gray-300">{result.path}</code>
                  <span className="text-gray-500 dark:text-gray-400">
                    {result.exists && result.writable
                      ? '— Exists & writable'
                      : result.exists
                      ? '— Exists but not writable'
                      : '— Does not exist'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Substitution Variables - Using Reusable Component */}
      <div className="mb-6">
        <SubstitutionTable
          rows={substitutions}
          onChange={setSubstitutions}
          showPlaceholders={true}
          maxRows={50}
        />
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <button
          onClick={resetDefaults}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
        >
          Reset to Defaults
        </button>
        <button
          onClick={saveSettings}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : '💾 Save Settings'}
        </button>
      </div>
    </div>
  );
}
