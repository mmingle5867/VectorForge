import type { Config, PluginConfig } from 'svgo';

export type SVGOPreset = 'balanced' | 'maximum-quality' | 'optimized-size';

const balancedPlugins: PluginConfig[] = [
  { name: 'preset-default', params: { overrides: { removeViewBox: false } } } as PluginConfig,
  'removeXMLNS',
  'convertStyleToAttrs',
  'reusePaths',
  { name: 'cleanupIds' } as PluginConfig,
  { name: 'mergePaths' } as PluginConfig,
  { name: 'prefixIds', params: { prefix: 'vf-' } } as PluginConfig,
];

const maxQualityPlugins: PluginConfig[] = [
  { name: 'preset-default', params: { overrides: { removeViewBox: false, mergePaths: false } } } as PluginConfig,
  'removeXMLNS',
  'convertStyleToAttrs',
  { name: 'prefixIds', params: { prefix: 'vf-' } } as PluginConfig,
];

const optimizedSizePlugins: PluginConfig[] = [
  { name: 'preset-default', params: { overrides: { removeViewBox: false, cleanupNumericValues: { floatPrecision: 2 } } } } as PluginConfig,
  'removeXMLNS',
  'convertStyleToAttrs',
  'reusePaths',
  { name: 'mergePaths' } as PluginConfig,
  { name: 'prefixIds', params: { prefix: 'vf-' } } as PluginConfig,
];

export const svgoPresets: Record<SVGOPreset, Config> = {
  balanced: {
    multipass: true,
    floatPrecision: 3,
    plugins: balancedPlugins,
  },

  'maximum-quality': {
    multipass: true,
    floatPrecision: 4,
    plugins: maxQualityPlugins,
  },

  'optimized-size': {
    multipass: true,
    floatPrecision: 2,
    plugins: optimizedSizePlugins,
  },
};

export const defaultSVGOConfig = svgoPresets.balanced;

export function getSVGOConfig(preset: SVGOPreset = 'balanced'): Config {
  return svgoPresets[preset] || svgoPresets.balanced;
}

/**
 * Map VTracer preset names to SVGO preset names.
 */
export function vtracerPresetToSVGO(vtracerPreset: string): SVGOPreset {
  switch (vtracerPreset) {
    case 'maximumQuality':
      return 'maximum-quality';
    case 'optimizedForSize':
      return 'optimized-size';
    case 'balanced':
    default:
      return 'balanced';
  }
}