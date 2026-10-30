/*
 * Versioned personal preset format, deliberately independent from any UI or
 * audio nodes. Safe to import/export as JSON. There is no external storage.
 */
import { EQ_BANDS, LAYERS, STORM_DEFAULTS } from './config.js';

export const PERSONAL_KEY = 'static.personal-presets.v1';
export const EXPORT_FORMAT = 'static-presets';
export const MAX_PERSONAL = 50;
export const MAX_IMPORT_BYTES = 128 * 1024;

const bound = (value, min, max, fallback = min) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 48);
}

export function cleanSound(sound) {
  const mix = Object.fromEntries(LAYERS.map(layer => [layer.id, bound(sound?.mix?.[layer.id], 0, 100)]));
  const eq = Object.fromEntries(LAYERS.map(layer => [
    layer.id, EQ_BANDS.map((_, i) => bound(sound?.eq?.[layer.id]?.[i], -12, 12, 0))
  ]));
  const storm = {
    distance: bound(sound?.storm?.distance, 0, 100, STORM_DEFAULTS.distance),
    activity: bound(sound?.storm?.activity, 0, 100, STORM_DEFAULTS.activity)
  };
  return { mix, eq, storm, level: bound(sound?.level, 0, 100, 37) };
}

export function cleanPreset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  const id = typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(raw.id) ? raw.id : newId();
  const updatedAt = typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
    ? raw.updatedAt : new Date().toISOString();
  return { id, name, ...cleanSound(raw), updatedAt };
}

export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export function cleanPresets(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  const names = new Set();
  return value.slice(0, MAX_PERSONAL * 3).map(cleanPreset).filter(p => {
    if (!p) return false;
    const label = p.name.toLocaleLowerCase();
    if (ids.has(p.id) || names.has(label) || ids.size >= MAX_PERSONAL) return false;
    ids.add(p.id);
    names.add(label);
    return true;
  });
}

export function loadPersonal(storage) {
  try { return cleanPresets(JSON.parse(storage.getItem(PERSONAL_KEY) || '[]')); }
  catch { return []; }
}

export function savePersonal(storage, presets) {
  const clean = cleanPresets(presets);
  storage.setItem(PERSONAL_KEY, JSON.stringify(clean));
  return clean;
}

export function addPersonal(presets, name, sound) {
  name = cleanName(name);
  if (!name) throw new Error('Enter a name for your preset.');
  if (presets.length >= MAX_PERSONAL) throw new Error('You have reached the 50-preset limit.');
  if (presets.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('That name is already used. Select the preset and choose Update instead.');
  }
  const item = cleanPreset({ id: newId(), name, ...cleanSound(sound), updatedAt: new Date().toISOString() });
  return [...presets, item];
}

export function updatePersonal(presets, id, sound, name = null) {
  const existing = presets.find(p => p.id === id);
  if (!existing) throw new Error('Select a personal preset first.');
  const newName = name === null ? existing.name : cleanName(name);
  if (!newName) throw new Error('Enter a name for your preset.');
  if (presets.some(p => p.id !== id && p.name.toLocaleLowerCase() === newName.toLocaleLowerCase())) {
    throw new Error('That name is already used by another preset.');
  }
  return presets.map(p => p.id !== id ? p : {
    ...p, ...cleanSound(sound), name: newName, updatedAt: new Date().toISOString()
  });
}

export function exportPersonal(presets) {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), presets: cleanPresets(presets) }, null, 2);
}

export function importPersonal(jsonText, existing) {
  if (new TextEncoder().encode(jsonText).length > MAX_IMPORT_BYTES) throw new Error('File is too large.');
  const parsed = JSON.parse(jsonText);
  if (parsed?.format !== EXPORT_FORMAT || parsed?.version !== 1 || !Array.isArray(parsed?.presets)) {
    throw new Error('This is not a Static preset export (version 1).');
  }
  // Validate every imported item rather than silently accepting malformed data.
  if (parsed.presets.length > MAX_PERSONAL || parsed.presets.some(p => !p || !cleanName(p.name))) {
    throw new Error('Preset export contains missing names or too many presets.');
  }
  const uniqueNew = cleanPresets(parsed.presets);
  if (uniqueNew.length !== parsed.presets.length) throw new Error('Preset export contains duplicate names or IDs.');
  const merged = cleanPresets(existing);
  let added = 0;
  let replaced = 0;
  for (const preset of uniqueNew) {
    const i = merged.findIndex(p => p.name.toLocaleLowerCase() === preset.name.toLocaleLowerCase());
    if (i >= 0) {
      merged[i] = { ...preset, id: merged[i].id }; // Preserve local selection identity.
      replaced++;
    } else {
      if (merged.length >= MAX_PERSONAL) throw new Error('Import exceeds the 50-preset limit.');
      merged.push({ ...preset, id: newId() }); // Imports do not reuse foreign IDs.
      added++;
    }
  }
  return { presets: merged, added, replaced };
}
