'use client';

import { useState } from 'react';
import {
  type VTracerSettings,
  DEFAULT_VTRACER_SETTINGS,
  VTRACER_PRESETS,
  PARAMETER_RANGES,
  PARAMETER_TOOLTIPS,
} from '@/lib/vtracer-presets';

// ============================================================================
// Types
// ============================================================================

interface VTracerSettingsProps {
  settings: VTracerSettings;
  onChange: (settings: VTracerSettings) => void;
  onTest?: (settings: VTracerSettings) => void;
  testLoading?: boolean;
  testResult?: TestResult | null;
  compact?: boolean;
}

export interface TestResult {
  originalSize: number;
  originalWidth: number;
  originalHeight: number;
  svgSize: number;
  svgBase64: string;
  compressionRatio: string;
  processingTimeMs: number;
}

// ============================================================================
// Tooltip
// ============================================================================

function Tooltip({ content }: { content: string }) {
  const [show, setShow] = useState(false);

  return (
    <span className="relative inline-flex items-center ml-1.5">
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="cursor-help"
      >
        <svg className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </span>
      {show && (
        <span className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 w-56 rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-gray-700">
          {content}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
        </span>
      )}
    </span>
  );
}

// ============================================================================
// Slider Component
// ============================================================================

function Slider({
  label,
  tooltip,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {label}
          </label>
          <Tooltip content={tooltip} />
        </div>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-700 dark:bg-gray-700 dark:text-gray-300">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-gray-200 dark:bg-gray-600 accent-blue-600"
      />
      <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function VTracerSettingsPanel({
  settings,
  onChange,
  onTest,
  testLoading = false,
  testResult = null,
  compact = false,
}: VTracerSettingsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Apply a preset
  const applyPreset = (presetName: string) => {
    const preset = VTRACER_PRESETS[presetName];
    if (preset) {
      onChange({
        ...preset,
        preset: presetName as VTracerSettings['preset'],
      });
    }
  };

  // Update a single parameter
  const updateParam = <K extends keyof VTracerSettings>(key: K, value: VTracerSettings[K]) => {
    onChange({
      ...settings,
      preset: 'custom',
      [key]: value,
    });
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 ${compact ? 'p-4' : 'p-6'}`}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-gray-900 dark:text-white`}>
            VTracer Optimization
          </h3>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            settings.preset === 'balanced'
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              : settings.preset === 'maximumQuality'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              : settings.preset === 'optimizedForSize'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400'
          }`}>
            {settings.preset === 'balanced' && '⚖️ Balanced'}
            {settings.preset === 'maximumQuality' && '✨ Max Quality'}
            {settings.preset === 'optimizedForSize' && '📦 Size Optimized'}
            {settings.preset === 'custom' && '🔧 Custom'}
          </span>
        </div>
        {onTest && (
          <button
            onClick={() => onTest(settings)}
            disabled={testLoading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50 transition-colors"
          >
            {testLoading ? (
              <>
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Testing...
              </>
            ) : (
              <>🧪 Test Settings</>
            )}
          </button>
        )}
      </div>

      {/* Preset Buttons */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <button
          onClick={() => applyPreset('balanced')}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            settings.preset === 'balanced'
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          ⚖️ Balanced
          <span className="block mt-0.5 text-[10px] font-normal opacity-70">Default</span>
        </button>
        <button
          onClick={() => applyPreset('maximumQuality')}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            settings.preset === 'maximumQuality'
              ? 'border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-900/30 dark:text-purple-400'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          ✨ Max Quality
          <span className="block mt-0.5 text-[10px] font-normal opacity-70">Detailed</span>
        </button>
        <button
          onClick={() => applyPreset('optimizedForSize')}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            settings.preset === 'optimizedForSize'
              ? 'border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/30 dark:text-green-400'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          📦 Small Size
          <span className="block mt-0.5 text-[10px] font-normal opacity-70">Compact</span>
        </button>
      </div>

      {/* Advanced Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mb-3 flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:bg-gray-700/50 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
      >
        <span>Advanced Settings</span>
        <svg
          className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Advanced Parameters */}
      {showAdvanced && (
        <div className="space-y-4 rounded-lg border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <Slider
            label="Color Precision"
            tooltip={PARAMETER_TOOLTIPS.colorPrecision}
            value={settings.colorPrecision}
            min={PARAMETER_RANGES.colorPrecision.min}
            max={PARAMETER_RANGES.colorPrecision.max}
            onChange={(val) => updateParam('colorPrecision', val)}
          />

          <Slider
            label="Filter Speckle"
            tooltip={PARAMETER_TOOLTIPS.filterSpeckle}
            value={settings.filterSpeckle}
            min={PARAMETER_RANGES.filterSpeckle.min}
            max={PARAMETER_RANGES.filterSpeckle.max}
            onChange={(val) => updateParam('filterSpeckle', val)}
          />

          <Slider
            label="Gradient Step"
            tooltip={PARAMETER_TOOLTIPS.gradientStep}
            value={settings.gradientStep}
            min={PARAMETER_RANGES.gradientStep.min}
            max={PARAMETER_RANGES.gradientStep.max}
            onChange={(val) => updateParam('gradientStep', val)}
          />

          {/* Curve Fitting Toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Curve Fitting
              </label>
              <Tooltip content={PARAMETER_TOOLTIPS.curveFitting} />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => updateParam('curveFitting', 'spline')}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  settings.curveFitting === 'spline'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
              >
                Spline (Smooth)
              </button>
              <button
                onClick={() => updateParam('curveFitting', 'polygon')}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  settings.curveFitting === 'polygon'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
              >
                Polygon (Sharp)
              </button>
            </div>
          </div>

          <Slider
            label="Corner Threshold"
            tooltip={PARAMETER_TOOLTIPS.cornerThreshold}
            value={settings.cornerThreshold}
            min={PARAMETER_RANGES.cornerThreshold.min}
            max={PARAMETER_RANGES.cornerThreshold.max}
            onChange={(val) => updateParam('cornerThreshold', val)}
          />

          <Slider
            label="Segment Length"
            tooltip={PARAMETER_TOOLTIPS.segmentLength}
            value={settings.segmentLength}
            min={PARAMETER_RANGES.segmentLength.min}
            max={PARAMETER_RANGES.segmentLength.max}
            onChange={(val) => updateParam('segmentLength', val)}
          />

          <Slider
            label="Splice Threshold"
            tooltip={PARAMETER_TOOLTIPS.spliceThreshold}
            value={settings.spliceThreshold}
            min={PARAMETER_RANGES.spliceThreshold.min}
            max={PARAMETER_RANGES.spliceThreshold.max}
            onChange={(val) => updateParam('spliceThreshold', val)}
          />
        </div>
      )}

      {/* Test Result */}
      {testResult && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
          <h4 className="mb-3 text-xs font-semibold uppercase text-amber-800 dark:text-amber-300">
            Test Result
          </h4>

          {/* Stats Grid */}
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div className="rounded-md bg-white p-2 text-center dark:bg-gray-800">
              <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Original</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {formatBytes(testResult.originalSize)}
              </p>
            </div>
            <div className="rounded-md bg-white p-2 text-center dark:bg-gray-800">
              <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">SVG Output</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {formatBytes(testResult.svgSize)}
              </p>
            </div>
            <div className="rounded-md bg-white p-2 text-center dark:bg-gray-800">
              <p className="text-[10px] uppercase text-gray-500 dark:text-gray-400">Ratio</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {testResult.compressionRatio}%
              </p>
            </div>
          </div>

          {/* SVG Preview */}
          <div className="rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-1 text-[10px] uppercase text-gray-500 dark:text-gray-400">SVG Preview</p>
            <div className="flex items-center justify-center overflow-hidden rounded bg-gray-50 dark:bg-gray-900" style={{ maxHeight: '200px' }}>
              <img
                src={`data:image/svg+xml;base64,${testResult.svgBase64}`}
                alt="SVG Preview"
                className="max-h-[200px] max-w-full object-contain"
              />
            </div>
            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
              {testResult.originalWidth}×{testResult.originalHeight}px • Processed in {testResult.processingTimeMs}ms
            </p>
          </div>
        </div>
      )}
    </div>
  );
}