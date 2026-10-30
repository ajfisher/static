import { NoiseEngine } from './audio-engine.js';
import { EQ_BANDS, LAYERS, PRESETS, STORM_DEFAULTS, blankEQ, presetEQ } from './config.js';
import { cleanSound, loadPersonal, savePersonal, addPersonal, updatePersonal, exportPersonal, importPersonal, MAX_IMPORT_BYTES } from './personal-presets.js';

const $ = selector => document.querySelector(selector);
const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));
const clampDB = value => Math.max(-12, Math.min(12, Number(value) || 0));
const dbText = value => `${value > 0 ? '+' : ''}${value} dB`;
let openedLayer = null;
function cleanEQ(saved) {
  const result = blankEQ();
  for (const layer of LAYERS) {
    if (Array.isArray(saved?.[layer.id])) {
      result[layer.id] = EQ_BANDS.map((_, index) => clampDB(saved[layer.id][index]));
    }
  }
  return result;
}
const engine = new NoiseEngine();
const outputModeStorageKey = 'static.output-mode';
let outputMode = 'media';
try {
  const saved = localStorage.getItem(outputModeStorageKey);
  outputMode = ['media', 'direct', 'buffered'].includes(saved) ? saved : 'media';
} catch (_) { /* storage optional */ }
engine.setOutputMode(outputMode);
const outputModeSelect = $('#outputMode');
outputModeSelect.value = outputMode;
function renderDiagnostics() {
  const diagnostic = engine.getDiagnostics();
  $('#audioDiagnosticText').textContent = [
    `Output: ${diagnostic.mode}`,
    `AudioContext: ${diagnostic.context}`,
    `Media element paused: ${diagnostic.mediaPaused ?? 'not created'}`,
    `Buffered ready: ${diagnostic.buffered?.ready ?? false}`,
    `Buffered file bytes: ${diagnostic.buffered?.bytes ?? 0}`,
    `Page: ${document.visibilityState}`,
    '',
    ...diagnostic.events.map(event => `${event.at}  ${event.message}`)
  ].join('\n');
}
outputModeSelect.addEventListener('change', event => {
  const next = event.target.value;
  try {
    engine.setOutputMode(next);
    outputMode = next;
    try { localStorage.setItem(outputModeStorageKey, next); } catch (_) {}
    renderOutputModeHelp();
    renderDiagnostics();
  } catch (error) {
    event.target.value = outputMode;
    $('#outputModeNote').textContent = error.message || String(error);
  }
});
document.addEventListener('visibilitychange', () => {
  engine.logEvent(`page ${document.visibilityState}; context ${engine.context?.state || 'not started'}`);
  if (!document.hidden) {
    renderDiagnostics();
    updateTimerDisplay();
  }
});
$('#audioDiagnostics').addEventListener('toggle', renderDiagnostics);

function renderOutputModeHelp() {
  const messages = {
    media: 'Live synthesis through a media element. Improves some lock-screen periods but may still stutter.',
    direct: 'Original direct Web Audio output. Your Android test found persistent stuttering under lock.',
    buffered: 'Prepare a two-minute WAV while foregrounded, then press Play. No live synthesis is needed while locked.'
  };
  $('#outputModeNote').textContent = messages[outputMode];
  $('#bufferedControls').hidden = outputMode !== 'buffered';
  renderBufferedStatus();
}

function renderBufferedStatus() {
  const ready = engine.isBufferedReady();
  $('#bufferedStatus').textContent = engine.playing && outputMode === 'buffered'
    ? (ready ? 'Playing prepared audio. EQ and mix edits apply after preparing again.' : 'Playing previous sound; changes need preparing again.')
    : (ready ? 'Ready to play. Prepared sound matches the current mix.' : 'Not prepared for this mix. Press Prepare, then Play.');
  $('#prepareBufferedBtn').disabled = engine.playing;
}
$('#prepareBufferedBtn').addEventListener('click', async () => {
  if (engine.playing) return;
  const btn = $('#prepareBufferedBtn');
  const play = $('#playBtn');
  btn.disabled = true;
  play.disabled = true;
  outputModeSelect.disabled = true;
  $('#bufferedStatus').textContent = 'Generating audio locally. Keep Static in the foreground…';
  $('#errorBanner').hidden = true;
  try {
    engine.setMix(state.mix);
    engine.setAllEQ(state.eq);
    engine.setStorm(state.storm);
    engine.setLevel(state.level);
    const result = await engine.prepareBuffered();
    $('#bufferedStatus').textContent = 'Ready: ' + (result.bytes / 1048576).toFixed(1) + ' MB generated. Press Play.';
    renderDiagnostics();
  } catch (error) {
    $('#bufferedStatus').textContent = 'Preparation failed: ' + (error.message || error);
    $('#errorBanner').hidden = false;
    $('#errorBanner').textContent = 'Unable to prepare buffered sound: ' + (error.message || error);
  } finally {
    btn.disabled = false;
    play.disabled = false;
    outputModeSelect.disabled = false;
  }
});
renderOutputModeHelp();

let state = {
  preset: 'focus',
  mix: { ...PRESETS[0].mix },
  eq: presetEQ(PRESETS[0]),
  level: 37,
  timer: 0,
  storm: { ...STORM_DEFAULTS }
};

try {
  const saved = JSON.parse(localStorage.getItem('static.settings') || 'null');
  if (saved && typeof saved === 'object') {
    state = {
      preset: String(saved.preset || 'focus'),
      mix: Object.fromEntries(LAYERS.map(layer => [layer.id, clamp(saved.mix?.[layer.id] ?? PRESETS[0].mix[layer.id])])),
      eq: saved.eq ? cleanEQ(saved.eq) : presetEQ(PRESETS[0]),
      level: clamp(saved.level ?? 37),
      timer: [0, 15, 30, 60, 120, 240].includes(Number(saved.timer)) ? Number(saved.timer) : 0,
      storm: {
        distance: clamp(saved.storm?.distance ?? STORM_DEFAULTS.distance),
        activity: clamp(saved.storm?.activity ?? STORM_DEFAULTS.activity)
      }
    };
  }
} catch (_) { /* continue with defaults if storage is unavailable */ }

let personalPresets = [];
try { personalPresets = loadPersonal(localStorage); } catch (_) { /* restricted browser storage */ }
let activePersonalId = state.preset.startsWith('personal:') ? state.preset.slice('personal:'.length) : null;
if (activePersonalId && !personalPresets.some(p => p.id === activePersonalId)) {
  activePersonalId = null;
  state.preset = 'custom';
}
if (activePersonalId) {
  const selected = personalPresets.find(p => p.id === activePersonalId);
  if (selected) $('#personalName').value = selected.name;
}

function persist() {
  try { localStorage.setItem('static.settings', JSON.stringify(state)); } catch (_) { /* optional */ }
}

function updateRange(range) {
  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  range.style.setProperty('--fill', `${100 * (Number(range.value) - min) / (max - min)}%`);
}

function renderSliders() {
  const host = $('#layers');
  host.textContent = '';
  for (const layer of LAYERS) {
    const row = document.createElement('div');
    row.className = 'layer';
    const edited = state.eq[layer.id].some(gain => gain !== 0);
    const expanded = openedLayer === layer.id;
    row.innerHTML = `
      <div class="layer-heading">
        <span class="layer-mark ${layer.id}" aria-hidden="true"></span>
        <div class="layer-name">
          <label for="layer-${layer.id}">${layer.name}</label>
          <span>${layer.subtitle}</span>
        </div>
        <button type="button" class="eq-toggle ${edited ? 'eq-edited' : ''}" aria-expanded="${expanded}" aria-controls="eq-${layer.id}">EQ${edited ? ' ·' : ''}</button>
        <output id="output-${layer.id}" for="layer-${layer.id}">${state.mix[layer.id]}%</output>
      </div>
      <input id="layer-${layer.id}" type="range" min="0" max="100" step="1" value="${state.mix[layer.id]}" aria-label="${layer.name} level" />
      <div class="eq-panel" id="eq-${layer.id}" ${expanded ? '' : 'hidden'}>
        <div class="eq-topline">
          <span>Frequency shaping</span>
          <button type="button" class="eq-flat">Reset EQ</button>
        </div>
        <div class="eq-bands">
          ${EQ_BANDS.map((band, index) => `
            <div class="eq-band">
              <label for="eq-${layer.id}-${index}">${band.label}</label>
              <input type="range" id="eq-${layer.id}-${index}" min="-12" max="12" step="1" value="${state.eq[layer.id][index]}" aria-label="${layer.name} ${band.label} EQ gain"/>
              <output for="eq-${layer.id}-${index}">${dbText(state.eq[layer.id][index])}</output>
            </div>
          `).join('')}
        </div>
        <p class="eq-note">Boost or cut relative frequency levels. These dB settings are not a measure of headphone loudness.</p>
      </div>
    `;
    const slider = row.querySelector(`#layer-${layer.id}`);
    updateRange(slider);
    slider.addEventListener('input', () => {
      state.mix[layer.id] = clamp(slider.value);
      state.preset = 'custom';
      row.querySelector(`#output-${layer.id}`).value = `${state.mix[layer.id]}%`;
      updateRange(slider);
      engine.setMix(state.mix);
      renderPresets();
      renderPersonalPresets();
      updateCurrentSound();
      persist();
    });
    row.querySelector('.eq-toggle').addEventListener('click', () => {
      openedLayer = openedLayer === layer.id ? null : layer.id;
      renderSliders();
    });
    row.querySelectorAll('.eq-band input').forEach((input, index) => {
      updateRange(input);
      input.addEventListener('input', () => {
        state.eq[layer.id][index] = clampDB(input.value);
        state.preset = 'custom';
        row.querySelectorAll('.eq-band output')[index].value = dbText(state.eq[layer.id][index]);
        row.querySelector('.eq-toggle').classList.toggle('eq-edited', state.eq[layer.id].some(value => value !== 0));
        row.querySelector('.eq-toggle').textContent = state.eq[layer.id].some(value => value !== 0) ? 'EQ ·' : 'EQ';
        updateRange(input);
        engine.setEQ(layer.id, state.eq[layer.id]);
        renderPresets();
        renderPersonalPresets();
        updateCurrentSound();
        persist();
      });
    });
    row.querySelector('.eq-flat').addEventListener('click', () => {
      state.eq[layer.id] = EQ_BANDS.map(() => 0);
      state.preset = 'custom';
      engine.setEQ(layer.id, state.eq[layer.id]);
      renderSliders();
      renderPresets();
      renderPersonalPresets();
      updateCurrentSound();
      persist();
    });
    host.append(row);
  }
}

function renderPresets() {
  const host = $('#presets');
  host.textContent = '';
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.className = `preset ${state.preset === preset.id ? 'selected' : ''}`;
    button.type = 'button';
    button.textContent = preset.label;
    button.setAttribute('aria-pressed', String(state.preset === preset.id));
    button.addEventListener('click', () => {
      state.preset = preset.id;
      activePersonalId = null;
      $('#personalName').value = '';
      state.mix = { ...preset.mix };
      state.eq = presetEQ(preset);
      state.storm = { ...STORM_DEFAULTS, ...(preset.storm || {}) };
      engine.setMix(state.mix);
      engine.setAllEQ(state.eq);
      engine.setStorm(state.storm);
      renderStormControls();
      renderSliders();
      renderPresets();
      renderPersonalPresets();
      updateCurrentSound();
      persist();
    });
    host.append(button);
  }
}


// Personal mixes persist in localStorage independently of the current session.
// Export/import lets people retain their presets if site storage is cleared.
function presetNotice(message, error = false) {
  const node = $('#personalNotice');
  node.textContent = message;
  node.classList.toggle('error', error);
}

function renderPersonalPresets() {
  const host = $('#personalPresets');
  host.replaceChildren();
  if (!personalPresets.length) {
    const empty = document.createElement('span');
    empty.className = 'personal-empty';
    empty.textContent = 'No saved mixes yet.';
    host.append(empty);
  }
  for (const saved of personalPresets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `personal-chip ${state.preset === 'personal:' + saved.id ? 'active' : ''}`;
    button.textContent = saved.name;
    button.title = `Load ${saved.name}`;
    button.setAttribute('aria-pressed', String(state.preset === 'personal:' + saved.id));
    button.addEventListener('click', () => {
      activePersonalId = saved.id;
      state.preset = 'personal:' + saved.id;
      const sound = cleanSound(saved);
      state.mix = sound.mix;
      state.eq = sound.eq;
      state.storm = sound.storm;
      state.level = sound.level;
      $('#personalName').value = saved.name;
      applySoundState();
      renderSliders();
      renderPresets();
      renderPersonalPresets();
      renderStormControls();
      updateCurrentSound();
      persist();
      presetNotice(`Loaded ${saved.name}.`);
    });
    host.append(button);
  }
  $('#selectedPresetActions').hidden = !activePersonalId;
}

function applySoundState() {
  engine.setMix(state.mix);
  engine.setAllEQ(state.eq);
  engine.setStorm(state.storm);
  engine.setLevel(state.level);
  $('#master').value = state.level;
  $('#masterOutput').value = state.level + '%';
  updateRange($('#master'));
}

function storePersonal(next, message) {
  try {
    personalPresets = savePersonal(localStorage, next);
    renderPersonalPresets();
    presetNotice(message);
    return true;
  } catch (error) {
    presetNotice('Unable to write browser storage: ' + (error.message || error), true);
    return false;
  }
}

$('#saveNewPersonalBtn').addEventListener('click', () => {
  try {
    const next = addPersonal(personalPresets, $('#personalName').value, state);
    if (!storePersonal(next, 'Preset saved on this device. Export a backup if you want to keep it long term.')) return;
    activePersonalId = next[next.length - 1].id;
    state.preset = 'personal:' + activePersonalId;
    renderPersonalPresets();
    updateCurrentSound();
    persist();
  } catch (error) { presetNotice(error.message || String(error), true); }
});

$('#updatePersonalBtn').addEventListener('click', () => {
  try {
    const next = updatePersonal(personalPresets, activePersonalId, state, $('#personalName').value);
    if (!storePersonal(next, 'Preset updated.')) return;
    state.preset = 'personal:' + activePersonalId;
    renderPersonalPresets();
    updateCurrentSound();
    persist();
  } catch (error) { presetNotice(error.message || String(error), true); }
});

$('#deletePersonalBtn').addEventListener('click', () => {
  const existing = personalPresets.find(p => p.id === activePersonalId);
  if (!existing || !window.confirm(`Delete "${existing.name}"? This cannot be undone unless exported.`)) return;
  if (!storePersonal(personalPresets.filter(p => p.id !== activePersonalId), `Deleted ${existing.name}.`)) return;
  activePersonalId = null;
  state.preset = 'custom';
  $('#personalName').value = '';
  renderPersonalPresets();
  updateCurrentSound();
  persist();
});

$('#exportPersonalBtn').addEventListener('click', () => {
  try {
    const blob = new Blob([exportPersonal(personalPresets)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'static-personal-presets.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    presetNotice(`Exported ${personalPresets.length} presets.`);
  } catch (error) { presetNotice(error.message || String(error), true); }
});

$('#importPersonalBtn').addEventListener('click', () => $('#importPersonalFile').click());
$('#importPersonalFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Import file must be smaller than 128 KB.');
    const { presets, added, replaced } = importPersonal(await file.text(), personalPresets);
    storePersonal(presets, `Imported ${added} new preset(s), replaced ${replaced} matching name(s).`);
  } catch (error) { presetNotice('Import failed: ' + (error.message || error), true); }
  finally { event.target.value = ''; }
});

function renderStormControls() {
  $('#stormDistance').value = state.storm.distance;
  $('#stormActivity').value = state.storm.activity;
  $('#stormDistanceOutput').value = state.storm.distance + '% · ' + (state.storm.distance >= 60 ? 'distant' : state.storm.distance <= 35 ? 'near' : 'mid-range');
  $('#stormActivityOutput').value = state.storm.activity === 0 ? 'Off (manual only)' : state.storm.activity + '%';
  updateRange($('#stormDistance'));
  updateRange($('#stormActivity'));
}
for (const [id, key] of [['stormDistance', 'distance'], ['stormActivity', 'activity']]) {
  $('#' + id).addEventListener('input', event => {
    state.storm[key] = clamp(event.target.value);
    state.preset = 'custom';
    engine.setStorm(state.storm);
    renderStormControls();
    renderPresets();
    renderPersonalPresets();
    updateCurrentSound();
    persist();
  });
}
$('#triggerThunderBtn').addEventListener('click', () => {
  if (!engine.playing) {
    presetNotice('Press Play first to hear a thunder event.');
    return;
  }
  if (state.mix.thunder === 0) {
    presetNotice('Increase the Thunder layer before trying a strike.');
    return;
  }
  if (!engine.triggerThunder()) {
    presetNotice('Manual thunder works in live output modes. Buffered mode uses a pre-generated storm.');
    return;
  }
  presetNotice('Thunder triggered.');
});

function updateCurrentSound() {
  const preset = PRESETS.find(item => item.id === state.preset);
  const personal = personalPresets.find(p => p.id === activePersonalId);
  $('#mixTitle').textContent = preset?.label || (personal ? personal.name + (state.preset === 'custom' ? ' (edited)' : '') : 'Custom mix');
  $('#mixDescription').textContent = preset?.description || (personal ? 'Your saved personal sound' : 'Your own balance of synthetic noise');
  $('#visualiser').style.setProperty('--intensity', Math.max(0.3,
    Object.values(state.mix).reduce((sum, val) => sum + val, 0) / 250).toFixed(2));
  renderBufferedStatus();
}

function updatePlayer() {
  const playing = engine.playing;
  $('#playBtn').classList.toggle('active', playing);
  $('#playBtn').setAttribute('aria-label', playing ? 'Stop sound' : 'Play sound');
  $('#playBtn').setAttribute('aria-pressed', String(playing));
  $('#playLabel').textContent = playing ? 'Stop' : 'Play';
  $('#playIcon').innerHTML = playing
    ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
    : '<path d="M8 5.2a1 1 0 0 1 1.52-.85l10.05 6.8a1 1 0 0 1 0 1.7L9.52 19.65A1 1 0 0 1 8 18.8V5.2Z"/>';
  $('#visualiser').classList.toggle('playing', playing);
  $('#stateText').textContent = playing ? 'Now playing' : 'Ready when you are';
  $('#statusText').textContent = playing ? 'Playing on this device' : 'Sound stopped';
  outputModeSelect.disabled = playing;
  renderBufferedStatus();
  renderDiagnostics();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
}

function updateTimerDisplay() {
  const remaining = engine.getRemainingSeconds();
  const suffix = $('#timerRemaining');
  if (remaining === null) {
    suffix.textContent = state.timer ? 'Timer starts on Play' : 'No timer';
    return;
  }
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  suffix.textContent = (hours ? `${hours}:${String(minutes).padStart(2, '0')}` : `${minutes}`)
    + `:${String(seconds).padStart(2, '0')} left`;
  if (remaining === 0 && engine.playing) {
    void stopAudio();
  }
}

let busy = false;
async function playAudio() {
  if (busy || engine.playing) return;
  if (outputMode === 'buffered' && !engine.isBufferedReady()) {
    $('#errorBanner').hidden = false;
    $('#errorBanner').textContent = 'Press Prepare to generate audio for this mix, then press Play.';
    return;
  }
  busy = true;
  const button = $('#playBtn');
  button.disabled = true;
  $('#statusText').textContent = 'Starting audio…';
  try {
    engine.setMix(state.mix);
    engine.setAllEQ(state.eq);
    engine.setLevel(state.level);
    engine.setStorm(state.storm);
    engine.setTimer(state.timer);
    await engine.play();
    $('#errorBanner').hidden = true;
    updatePlayer();
    updateTimerDisplay();
    renderDiagnostics();
    renderBufferedStatus();
  } catch (error) {
    $('#errorBanner').hidden = false;
    $('#errorBanner').textContent = `Couldn't start audio: ${error.message || error}`;
    $('#statusText').textContent = 'Audio unavailable';
    renderDiagnostics();
    console.error(error);
  } finally {
    busy = false;
    button.disabled = false;
  }
}

async function stopAudio() {
  if (busy || !engine.playing) return;
  busy = true;
  const button = $('#playBtn');
  button.disabled = true;
  try {
    await engine.stop();
  } catch (error) {
    console.error(error);
  } finally {
    busy = false;
    button.disabled = false;
    updatePlayer();
    updateTimerDisplay();
    renderDiagnostics();
    renderBufferedStatus();
  }
}

$('#playBtn').addEventListener('click', () => {
  if (engine.playing) void stopAudio();
  else void playAudio();
});

$('#master').value = state.level;
updateRange($('#master'));
$('#masterOutput').value = `${state.level}%`;
$('#master').addEventListener('input', event => {
  state.level = clamp(event.target.value);
  state.preset = 'custom';
  $('#masterOutput').value = `${state.level}%`;
  updateRange(event.target);
  engine.setLevel(state.level);
  renderPresets();
  renderPersonalPresets();
  updateCurrentSound();
  persist();
});

$('#timer').value = state.timer;
$('#timer').addEventListener('change', event => {
  state.timer = Number(event.target.value);
  engine.setTimer(state.timer);
  updateTimerDisplay();
  persist();
});

$('#resetBtn').addEventListener('click', () => {
  state.preset = 'focus';
  activePersonalId = null;
  $('#personalName').value = '';
  state.mix = { ...PRESETS[0].mix };
  state.eq = presetEQ(PRESETS[0]);
  state.level = 37;
  state.timer = 0;
  state.storm = { ...STORM_DEFAULTS };
  $('#master').value = 37;
  $('#masterOutput').value = '37%';
  updateRange($('#master'));
  $('#timer').value = 0;
  engine.setMix(state.mix);
  engine.setAllEQ(state.eq);
  engine.setLevel(state.level);
  engine.setStorm(state.storm);
  engine.setTimer(0);
  renderStormControls();
  renderSliders();
  renderPresets();
  renderPersonalPresets();
  updateCurrentSound();
  updateTimerDisplay();
  persist();
});

renderSliders();
renderPresets();
renderPersonalPresets();
renderStormControls();
updateCurrentSound();
updatePlayer();
updateTimerDisplay();
setInterval(updateTimerDisplay, 1000);

if ('mediaSession' in navigator && 'MediaMetadata' in window) {
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Synthetic noise', artist: 'Static', album: 'Offline audio',
      artwork: [{ src: './icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: './icon-512.png', sizes: '512x512', type: 'image/png' }]
    });
  } catch (_) { /* artwork URL unavailable in embedded previews */ }
  for (const [action, fn] of [['play', playAudio], ['pause', stopAudio], ['stop', stopAudio]]) {
    try { navigator.mediaSession.setActionHandler(action, () => { void fn(); }); } catch (_) { /* optional */ }
  }
}

async function setupOffline() {
  const badge = $('#offlineStatus');
  if (!('serviceWorker' in navigator)) {
    badge.textContent = 'Offline install unavailable';
    return;
  }
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    badge.textContent = 'Offline ready';
    badge.classList.add('ready');
  } catch (error) {
    badge.textContent = 'Offline setup failed';
    console.error('Service worker:', error);
  }
}
window.addEventListener('load', () => { void setupOffline(); });

let installPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  $('#installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
