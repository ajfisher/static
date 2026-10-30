import { EQ_BANDS, LAYERS, STORM_DEFAULTS, blankEQ } from './config.js';

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const fadeSeconds = 18;

function makeFilter(context, type, frequency, Q = 0.707) {
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = Q;
  return filter;
}

function makeLfo(context, frequency, amount, target) {
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  const depth = context.createGain();
  depth.gain.value = amount;
  oscillator.connect(depth).connect(target);
  oscillator.start();
  return oscillator;
}

export class NoiseEngine {
  constructor() {
    this.context = null;
    this.channels = new Map();
    this.master = null;
    this.compressor = null;
    this.playing = false;
    this.level = 37;
    this.mix = Object.fromEntries(LAYERS.map(layer => [layer.id, 0]));
    this.eq = blankEQ();
    this.storm = { ...STORM_DEFAULTS };
    this.timerMinutes = 0;
    this.endsAt = null;
  }

  async initialise() {
    if (this.context) return;
    if (!AudioContextClass) throw new Error('Your browser does not support Web Audio. Try Chrome on Android.');
    if (!window.isSecureContext) throw new Error('Open this app over HTTPS or localhost to use the audio engine.');

    const context = new AudioContextClass({ latencyHint: 'playback' });
    try {
      if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable. Try an updated version of Chrome.');
      await context.audioWorklet.addModule('./noise-worklet.js');
      await context.audioWorklet.addModule('./thunder-worklet.js');
      await context.audioWorklet.addModule('./prime-motion-worklet.js');
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -15;
      compressor.knee.value = 24;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.3;
      const master = context.createGain();
      master.gain.value = 0;
      compressor.connect(master).connect(context.destination);

      for (const layer of LAYERS) {
        const isThunder = layer.source === 'thunder';
        const source = new AudioWorkletNode(context, isThunder ? 'static-thunder-source' : 'static-noise-source', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: isThunder ? { ...this.storm } : { kind: layer.source }
        });
        let tail = source;
        let spectralMotionTarget = null;
        let spectralMotionDepth = 0;
        for (const spec of layer.filters) {
          const filter = makeFilter(context, spec.type, spec.frequency, spec.Q);
          tail.connect(filter);
          tail = filter;
          if (spec.sweep) makeLfo(context, spec.sweep.rate, spec.sweep.depth, filter.frequency);
          if (spec.motionSweep) { spectralMotionTarget = filter.frequency; spectralMotionDepth = spec.motionSweep; }
        }
        // One separate, adjustable equaliser per layer. Place it after the tone-shaping filters.
        // Filters remain active when gain is 0 dB, which avoids a graph rebuild during playback.
        const eqFilters = EQ_BANDS.map(spec => {
          const filter = makeFilter(context, spec.type, spec.frequency, spec.q || 0.707);
          filter.gain.value = this.eq[layer.id][EQ_BANDS.indexOf(spec)];
          tail.connect(filter);
          tail = filter;
          return filter;
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
            // The gain and spectral motion are related, but not exactly in phase.
            const intensityDepth = context.createGain();
            intensityDepth.gain.value = layer.motion.depth;
            modulator.connect(intensityDepth, 0, 0);
            intensityDepth.connect(motion.gain);
            if (spectralMotionTarget) {
              const colourDepth = context.createGain();
              colourDepth.gain.value = spectralMotionDepth;
              modulator.connect(colourDepth, 1, 0);
              colourDepth.connect(spectralMotionTarget);
            }
          } else {
            layer.motion.components.forEach(component =>
              makeLfo(context, component.rate, component.depth, motion.gain)
            );
          }
        }
        const gain = context.createGain();
        gain.gain.value = 0;
        tail.connect(gain).connect(compressor);
        this.channels.set(layer.id, { source, gain, eqFilters, loudness: layer.loudness });
      }
      this.context = context;
      this.master = master;
      this.compressor = compressor;
      // start/resume happens only after the user presses Play.
      await context.suspend();
      this.updateLevels();
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
  }

  mixGain(amount, calibration) {
    return Math.pow(amount / 100, 1.65) * calibration;
  }

  masterGain() {
    // Soft default output, suitable for using headphones. No volume escalation.
    return 0.58 * Math.pow(this.level / 100, 1.65);
  }

  updateLevels() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const [id, node] of this.channels.entries()) {
      const target = this.mixGain(this.mix[id], node.loudness);
      node.gain.gain.setTargetAtTime(target, now, 0.065);
    }
    this.updateMaster();
  }

  updateMaster() {
    if (!this.context) return;
    const now = this.context.currentTime;
    const param = this.master.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    const target = this.playing ? this.masterGain() : 0;
    param.linearRampToValueAtTime(target, now + 0.12);
    if (this.playing && this.endsAt !== null) {
      const rampStart = Math.max(now + 0.12, this.endsAt - fadeSeconds);
      if (rampStart < this.endsAt) {
        param.setValueAtTime(target, rampStart);
        param.linearRampToValueAtTime(0, this.endsAt);
      }
    }
  }

  setMix(mix) {
    this.mix = { ...this.mix, ...mix };
    this.updateLevels();
  }

  setEQ(id, bandGains) {
    if (!Object.hasOwn(this.eq, id)) return;
    const safe = EQ_BANDS.map((_, index) => Math.max(-12, Math.min(12, Number(bandGains[index]) || 0)));
    this.eq[id] = safe;
    const channel = this.channels.get(id);
    if (!channel || !this.context) return;
    channel.eqFilters.forEach((filter, index) => {
      filter.gain.setTargetAtTime(safe[index], this.context.currentTime, 0.06);
    });
  }

  setAllEQ(eq) {
    for (const layer of LAYERS) this.setEQ(layer.id, eq[layer.id] || [0, 0, 0, 0, 0]);
  }

  setStorm(storm) {
    const bound = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
    };
    this.storm = {
      distance: bound(storm?.distance, this.storm.distance),
      activity: bound(storm?.activity, this.storm.activity)
    };
    this.channels.get('thunder')?.source.port.postMessage({ type: 'settings', ...this.storm });
  }

  triggerThunder() {
    this.channels.get('thunder')?.source.port.postMessage({ type: 'trigger' });
  }

  setLevel(level) {
    this.level = level;
    this.updateMaster();
  }

  setTimer(minutes) {
    this.timerMinutes = minutes;
    this.endsAt = this.playing && minutes > 0
      ? this.context.currentTime + minutes * 60
      : null;
    this.updateMaster();
  }

  getRemainingSeconds() {
    if (!this.playing || this.endsAt === null || !this.context) return null;
    return Math.max(0, Math.ceil(this.endsAt - this.context.currentTime));
  }

  async play() {
    await this.initialise();
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch (_) { /* optional */ }
    }
    await this.context.resume();
    this.playing = true;
    // Restart the timer after a Stop, but preserve it when changing a preset.
    this.endsAt = this.timerMinutes > 0
      ? this.context.currentTime + this.timerMinutes * 60
      : null;
    this.updateLevels();
  }

  async stop() {
    if (!this.context) return;
    this.playing = false;
    this.endsAt = null;
    this.updateMaster();
    // Let the fade reach silence before suspending the audio graph.
    await new Promise(resolve => setTimeout(resolve, 180));
    if (!this.playing && this.context.state === 'running') await this.context.suspend();
  }
}
