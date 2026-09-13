'use client';

import { useEffect, useState } from 'react';

import type { ControlPreset } from '@/lib/control-presets';

export default function ControlPresetManager() {
  const [presets, setPresets] = useState<ControlPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/control-presets', { cache: 'no-store' });
    const data = await response.json();
    if (response.ok && data.success) setPresets(data.presets);
    else setMessage(data.error || 'Unable to load presets');
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function update(action: string, values: Record<string, unknown>) {
    try {
      const response = await fetch('/api/control-presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...values }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to update preset');
      setPresets(data.presets);
      setMessage('Control presets updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update preset');
    }
  }

  async function addPreset() {
    const name = window.prompt('Preset name');
    if (!name?.trim()) return;
    const description = window.prompt('Preset description', '') ?? '';
    await update('save-preset', { name: name.trim(), description: description.trim() });
  }

  async function editPreset(preset: ControlPreset) {
    const name = window.prompt('Preset name', preset.name);
    if (!name?.trim()) return;
    const description = window.prompt('Preset description', preset.description) ?? preset.description;
    await update('save-preset', { id: preset.id, name: name.trim(), description: description.trim() });
  }

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Control Setting Presets</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Named combinations of vectorizer controls and raster-editor preparation settings.
          </p>
        </div>
        <button type="button" onClick={addPreset} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-bold text-white">Save Current Set</button>
      </div>
      {message && <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">{message}</p>}
      {loading ? <p className="mt-4 text-sm text-gray-500">Loading presets…</p> : presets.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No named presets yet. Adjust controls in Preview/Tune and choose Save Set, or save the current persistent set here.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {presets.map((preset) => (
            <div key={preset.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-bold">{preset.name}</p><p className="mt-1 text-xs text-gray-500">{preset.description || 'No description'}</p></div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => update('use-preset', { id: preset.id })} className="rounded border px-2 py-1 text-xs font-semibold">Use</button>
                  <button type="button" onClick={() => editPreset(preset)} className="rounded border px-2 py-1 text-xs font-semibold">Edit</button>
                  <button type="button" onClick={() => window.confirm(`Delete preset “${preset.name}”?`) && update('delete-preset', { id: preset.id })} className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-600">Delete</button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">Raster preparation: {preset.rasterPreparation.blur.toFixed(1)} blur · {preset.rasterPreparation.upscaleFactor}x upscale</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
