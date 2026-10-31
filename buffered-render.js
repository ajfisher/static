/*
 * Static buffered audio experiment.
 *
 * Render the existing synthetic graph into a finite PCM buffer while the page
 * is foregrounded, then hand a WAV Blob to a normal HTMLAudioElement.
 * No AudioContext or AudioWorklet is required during actual playback.
 *
 * This is deliberately a short-loop reliability experiment, not yet a
 * non-repeating long-form soundscape renderer.
 */
import { EQ_BANDS, LAYERS } from './config.js';

export const BUFFER_SECONDS = 120;
export const BUFFER_RATE = 32000;
export const BUFFER_CROSSFADE_SECONDS = 6;

export function soundFingerprint(sound) {
  return JSON.stringify(LAYERS.map(layer => ({
    id: layer.id,
    mix: Number(sound.mix?.[layer.id]) || 0,
    eq: (sound.eq?.[layer.id] || []).map(value => Number(value) || 0)
  })).concat([{ storm: {
    distance: Number(sound.storm?.distance) || 0,
    activity: Number(sound.storm?.activity) || 0
  } }]));
}

function wavHeader(view, frames, rate, channels) {
  const dataBytes = frames * channels * 2;
  function fourCC(offset, value) {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  }
  fourCC(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  fourCC(8, 'WAVE');
  fourCC(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  fourCC(36, 'data');
  view.setUint32(40, dataBytes, true);
}

// Crossfade the first few seconds into additional material rendered beyond
// the loop point. The seam is between the penultimate output sample at T
// and the original continuous sample at T, rather than a discontinuity at 0.
export function encodeLoopedWav(buffer, {
  durationSeconds = BUFFER_SECONDS,
  crossfadeSeconds = BUFFER_CROSSFADE_SECONDS
} = {}) {
  const rate = buffer.sampleRate;
  const frames = Math.round(durationSeconds * rate);
  const fade = Math.round(crossfadeSeconds * rate);
  if (!Number.isFinite(rate) || rate < 8000 || rate > 96000) throw new Error('Invalid sample rate');
  if (buffer.numberOfChannels !== 2 || !Number.isInteger(frames) || frames <= 0
      || !Number.isInteger(fade) || fade < 2 || fade >= frames
      || buffer.length < frames + fade) throw new Error('Invalid audio buffer for loop encoding');
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const result = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(result);
  wavHeader(view, frames, rate, 2);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < 2; channel++) {
      const data = channels[channel];
      let sample = data[i];
      if (i < fade) {
        const t = i / (fade - 1);
        const weight = t * t * (3 - 2 * t); // smoothstep
        sample = (1 - weight) * data[frames + i] + weight * data[i];
      }
      sample = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      view.setInt16(offset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
      offset += 2;
    }
  }
  return result;
}

function filter(context, spec) {
  const node = context.createBiquadFilter();
  node.type = spec.type;
  node.frequency.value = spec.frequency;
  node.Q.value = spec.q || spec.Q || 0.707;
  return node;
}

function lfo(context, component, target) {
  const osc = context.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = component.rate;
  const depth = context.createGain();
  depth.gain.value = component.depth;
  osc.connect(depth).connect(target);
  osc.start();
}

// Renders a complete, tunable soundscape without hardware output.
// All sound layers reuse Static's current AudioWorklet implementations.
export async function renderOfflineAudio(sound, {
  durationSeconds = BUFFER_SECONDS,
  sampleRate = BUFFER_RATE,
  crossfadeSeconds = BUFFER_CROSSFADE_SECONDS
} = {}) {
  if (typeof OfflineAudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
    throw new Error('Offline audio rendering is not supported by this browser');
  }
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round((durationSeconds + crossfadeSeconds) * sampleRate),
    sampleRate
  });
  if (!context.audioWorklet) throw new Error('Offline AudioWorklet is unavailable on this device');
  // Keep worklet modules identical to the live sound engine.
  for (const path of ['./noise-worklet.js', './thunder-worklet.js', './prime-motion-worklet.js']) {
    await context.audioWorklet.addModule(path);
  }

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -15;
  compressor.knee.value = 24;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.3;
  // User level is applied to the HTML media element, allowing live adjustment.
  compressor.connect(context.destination);

  for (const layer of LAYERS) {
    const amount = Number(sound.mix?.[layer.id]) || 0;
    if (amount <= 0) continue;
    const thunder = layer.source === 'thunder';
    const source = new AudioWorkletNode(context,
      thunder ? 'static-thunder-source' : 'static-noise-source', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: thunder ? { ...sound.storm } : { kind: layer.source }
      });
    let tail = source;
    let colourTarget = null;
    let colourDepth = 0;
    for (const spec of layer.filters) {
      const node = filter(context, spec);
      tail.connect(node);
      tail = node;
      if (spec.sweep) lfo(context, spec.sweep, node.frequency);
      if (spec.motionSweep) { colourTarget = node.frequency; colourDepth = spec.motionSweep; }
    }
    (sound.eq?.[layer.id] || [0, 0, 0, 0, 0]).forEach((gain, i) => {
      if (i >= EQ_BANDS.length) return;
      const node = filter(context, EQ_BANDS[i]);
      node.gain.value = Math.max(-12, Math.min(12, Number(gain) || 0));
      tail.connect(node);
      tail = node;
    });
    if (layer.motion) {
      const motion = context.createGain();
      motion.gain.value = layer.motion.base;
      tail.connect(motion);
      tail = motion;
      if (layer.motion.type === 'prime') {
        const modulator = new AudioWorkletNode(context, 'static-prime-motion', {
          numberOfInputs: 0,
          numberOfOutputs: 2,
          outputChannelCount: [1, 1],
          processorOptions: {
            style: layer.motion.style,
            periods: layer.motion.periods,
            seed: Math.floor(Math.random() * 0xffffffff) || 1
          }
        });
        const intensity = context.createGain();
        intensity.gain.value = layer.motion.depth;
        modulator.connect(intensity, 0, 0);
        intensity.connect(motion.gain);
        if (colourTarget) {
          const spectral = context.createGain();
          spectral.gain.value = colourDepth;
          modulator.connect(spectral, 1, 0);
          spectral.connect(colourTarget);
        }
      } else {
        for (const component of layer.motion.components) lfo(context, component, motion.gain);
      }
    }
    const gain = context.createGain();
    gain.gain.value = layer.loudness * Math.pow(amount / 100, 1.65);
    tail.connect(gain).connect(compressor);
  }
  const audio = await context.startRendering();
  return audio;
}

// Preserve the v4.2 finite-loop renderer alongside the raw AudioBuffer API.
export async function renderOfflineMix(sound, options = {}) {
  const audio = await renderOfflineAudio(sound, options);
  return encodeLoopedWav(audio, {
    durationSeconds: options.durationSeconds ?? BUFFER_SECONDS,
    crossfadeSeconds: options.crossfadeSeconds ?? BUFFER_CROSSFADE_SECONDS
  });
}
