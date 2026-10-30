import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PRESETS, LAYERS, EQ_BANDS } from '../config.js';
import { cleanSound, addPersonal, updatePersonal, savePersonal, loadPersonal, exportPersonal, importPersonal, cleanPresets } from '../personal-presets.js';

const state = {
  mix: { ...PRESETS.find(p => p.id === 'storm').mix },
  eq: Object.fromEntries(LAYERS.map(layer => [layer.id, EQ_BANDS.map(() => 0)])),
  storm: { distance: 83, activity: 24 },
  level: 29
};
function memoryStore() {
  const map = new Map();
  return { getItem(k) { return map.get(k) || null; }, setItem(k,v){map.set(k,v);} };
}

test('every built-in preset has a valid set of mix values including thunder', () => {
  for (const preset of PRESETS) {
    for (const layer of LAYERS) assert.ok(Number.isFinite(preset.mix[layer.id]), `${preset.id}:${layer.id}`);
    assert.deepEqual(Object.keys(cleanSound(preset).eq).sort(), LAYERS.map(x=>x.id).sort());
  }
});

test('save and reload a personal preset, including EQ, storm and master', () => {
  const storage = memoryStore();
  state.eq.thunder = [4, 2, 0, -5, -8];
  const item = addPersonal([], 'Storm for flying', state);
  savePersonal(storage, item);
  const restored = loadPersonal(storage);
  assert.equal(restored[0].name,'Storm for flying');
  assert.equal(restored[0].mix.thunder, 62);
  assert.deepEqual(restored[0].eq.thunder,[4,2,0,-5,-8]);
  assert.deepEqual(restored[0].storm,{distance:83,activity:24});
  assert.equal(restored[0].level,29);
});

test('cannot create case-insensitive duplicate names or invalid names', () => {
  const list = addPersonal([], 'Quiet Rain', state);
  assert.throws(() => addPersonal(list, 'quiet  rain', state), /already/);
  assert.throws(() => addPersonal(list, '', state), /name/);
});

test('update retains ID and replaces the current sound and name', () => {
  const list = addPersonal([], 'Rain', state);
  const changed = { ...state, level: 43 };
  const newer = updatePersonal(list, list[0].id, changed, 'Rain + bass');
  assert.equal(newer[0].id,list[0].id);
  assert.equal(newer[0].name,'Rain + bass');
  assert.equal(newer[0].level,43);
});

test('export/import roundtrip, merge same names without duplicate', () => {
  const saved = addPersonal([], 'Thunder mix', state);
  const exported = exportPersonal(saved);
  const imported = importPersonal(exported, []);
  assert.equal(imported.added,1);
  assert.equal(imported.replaced,0);
  assert.deepEqual(imported.presets[0].eq.thunder,saved[0].eq.thunder);
  const again = importPersonal(exported, imported.presets);
  assert.equal(again.added,0);
  assert.equal(again.replaced,1);
  assert.equal(again.presets.length,1);
  assert.equal(again.presets[0].id,imported.presets[0].id);
});

test('invalid and out-of-range import values are rejected or bounded', () => {
  assert.throws(() => importPersonal('{"format":"static-presets","version":99,"presets":[]}',[]), /not a Static/);
  const sound = cleanSound({mix:{white:Infinity,thunder:150},eq:{thunder:[-99,99,NaN,0,1]},storm:{distance:-30,activity:120},level:300});
  assert.equal(sound.mix.thunder,100);
  assert.equal(sound.mix.white,0);
  assert.deepEqual(sound.eq.thunder,[-12,12,0,0,1]);
  assert.equal(sound.storm.distance,0);
  assert.equal(sound.storm.activity,100);
  assert.equal(sound.level,100);
  assert.equal(cleanPresets([null,{}]).length,0);
});
