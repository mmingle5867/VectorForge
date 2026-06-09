/**
 * VectorForge - VTracer Optimization Presets
 * Defines preset configurations and parameter ranges for VTracer conversion.
 */

// ============================================================================
// Types
// ============================================================================

export interface VTracerSettings {
  preset: 'balanced' | 'maximumQuality' | 'optimizedForSize' | 'custom';
  colorPrecision: number;     // 4–12
  filterSpeckle: number;      // 0–20
  gradientStep: number;       // 8–30
  curveFitting: 'spline' | 'polygon';
  cornerThreshold: number;    // 30–90
  segmentLength: number;      // 2–12
  spliceThreshold: number;    // 20–80
}

// ============================================================================
// Presets
// ============================================================================

export const VTRACER_PRESETS: Record<string, Omit<VTracerSettings, 'preset'>> = {
  balanced: {
    colorPrecision: 6,
    filterSpeckle: 6,
    gradientStep: 16,
    curveFitting: 'spline',
    cornerThreshold: 70,
    segmentLength: 4,
    spliceThreshold: 45,
  },
  maximumQuality: {
    colorPrecision: 10,
    filterSpeckle: 2,
    gradientStep: 24,
    curveFitting: 'spline',
    cornerThreshold: 70,
    segmentLength: 2,
    spliceThreshold: 30,
  },
  optimizedForSize: {
    colorPrecision: 4,
    filterSpeckle: 8,
    gradientStep: 10,
    curveFitting: 'spline',
    cornerThreshold: 50,
    segmentLength: 8,
    spliceThreshold: 65,
  },
};

export const DEFAULT_VTRACER_SETTINGS: VTracerSettings = {
  preset: 'balanced',
  ...VTRACER_PRESETS.balanced,
};

// ============================================================================
// Parameter Definitions (for UI rendering)
// ============================================================================

export interface ParameterDef {
  key: keyof Omit<VTracerSettings, 'preset' | 'curveFitting'>;
  label: string;
  tooltip: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export const VTRACER_PARAMETERS: ParameterDef[] = [
  {
    key: 'colorPrecision',
    label: 'Color Precision',
    tooltip: 'Controls how many colors are preserved. Higher = more accurate colors but larger file size.',
    min: 4,
    max: 12,
    step: 1,
  },
  {
    key: 'filterSpeckle',
    label: 'Filter Speckle',
    tooltip: 'Removes small noise artifacts. Higher = cleaner SVG but may lose fine details.',
    min: 0,
    max: 20,
    step: 1,
    unit: 'px',
  },
  {
    key: 'gradientStep',
    label: 'Gradient Step',
    tooltip: 'Number of layers for gradients. Higher = smoother gradients but more SVG paths.',
    min: 8,
    max: 30,
    step: 1,
  },
  {
    key: 'cornerThreshold',
    label: 'Corner Threshold',
    tooltip: 'Angle threshold for corner detection. Lower = sharper corners. Higher = smoother curves.',
    min: 30,
    max: 90,
    step: 5,
    unit: '°',
  },
  {
    key: 'segmentLength',
    label: 'Segment Length',
    tooltip: 'Minimum path segment length. Lower = more detail. Higher = simpler, smaller SVGs.',
    min: 2,
    max: 12,
    step: 1,
    unit: 'px',
  },
  {
    key: 'spliceThreshold',
    label: 'Splice Threshold',
    tooltip: 'Controls path merging. Higher = fewer paths (smaller file) but potential detail loss.',
    min: 20,
    max: 80,
    step: 5,
    unit: '°',
  },
];

// ============================================================================
// Parameter Ranges & Tooltips (for component use)
// ============================================================================

export const PARAMETER_RANGES: Record<string, { min: number; max: number; step?: number }> = {
  colorPrecision: { min: 4, max: 12 },
  filterSpeckle: { min: 0, max: 20 },
  gradientStep: { min: 8, max: 30 },
  cornerThreshold: { min: 30, max: 90 },
  segmentLength: { min: 2, max: 12 },
  spliceThreshold: { min: 20, max: 80 },
};

export const PARAMETER_TOOLTIPS: Record<string, string> = {
  colorPrecision: 'Controls how many colors are preserved. Higher = more accurate colors but larger file size. Recommended: 6 for most designs.',
  filterSpeckle: 'Removes small noise artifacts (speckles). Higher = cleaner SVG but may lose fine details. Recommended: 4 for clean images.',
  gradientStep: 'Number of layers for gradients/color transitions. Higher = smoother gradients but more SVG paths. Recommended: 16.',
  curveFitting: 'Spline = smooth Bézier curves (smaller, smoother). Polygon = straight line segments (more accurate to pixel edges).',
  cornerThreshold: 'Angle threshold for detecting corners vs smooth curves. Lower = sharper/angular. Higher = smoother/rounder. Recommended: 60.',
  segmentLength: 'Minimum path segment length. Lower = more detail, larger file. Higher = simpler, smaller SVGs. Recommended: 4.',
  spliceThreshold: 'Controls how aggressively adjacent paths are merged. Higher = fewer paths (smaller file) but potential detail loss. Recommended: 45.',
};

// ============================================================================
// Preset Descriptions
// ============================================================================

export const PRESET_DESCRIPTIONS: Record<string, { label: string; description: string; icon: string }> = {
  balanced: {
    label: 'Balanced',
    description: 'Good quality and file size for most use cases',
    icon: '⚖️',
  },
  maximumQuality: {
    label: 'Maximum Quality',
    description: 'Highest fidelity, larger files. Best for detailed artwork',
    icon: '💎',
  },
  optimizedForSize: {
    label: 'Optimized for Size',
    description: 'Smallest files, simplified paths. Best for logos and icons',
    icon: '📦',
  },
  custom: {
    label: 'Custom',
    description: 'Fine-tune individual parameters',
    icon: '⚙️',
  },
};

/**
 * Convert VTracerSettings to the format expected by the conversion service.
 */
export function settingsToConversionOptions(settings: VTracerSettings): {
  colorMode: 'color' | 'binary';
  hierarchical: 'stacked' | 'cutout';
  filterSpeckle: number;
  colorPrecision: number;
  layerDifference: number;
  cornerThreshold: number;
  lengthThreshold: number;
  maxIterations: number;
  spliceThreshold: number;
  pathPrecision: number;
} {
  return {
    colorMode: 'color',
    hierarchical: 'stacked',
    filterSpeckle: settings.filterSpeckle,
    colorPrecision: settings.colorPrecision,
    layerDifference: settings.gradientStep,
    cornerThreshold: settings.cornerThreshold,
    lengthThreshold: settings.segmentLength,
    maxIterations: 10,
    spliceThreshold: settings.spliceThreshold,
    pathPrecision: settings.curveFitting === 'spline' ? 3 : 1,
  };
}