/*
 * Procedural thunder. Nothing is downloaded or scheduled on the UI thread.
 * Strikes, echoes and decay are generated using the AudioWorklet sample clock,
 * so timer throttling in a background tab does not determine event spacing.
 *
 * This is deliberately an approximation of distant thunder, not a recording.
 */
class ThunderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.distance = this.bound(options.processorOptions?.distance, 72);
    this.activity = this.bound(options.processorOptions?.activity, 45);
    this.channels = [this.channelState(), this.channelState()];
    this.samplesUntilStrike = this.activity > 0 ? Math.round(sampleRate * (2.5 + Math.random() * 4.5)) : Infinity;
    this.eventSamples = 0;
    this.eventLength = 0;
    this.eventStrength = 1;
    this.bursts = [];
    this.eventPan = 0;
    this.port.onmessage = event => {
      const data = event.data || {};
      if (data.type === 'settings') {
        this.distance = this.bound(data.distance, this.distance);
        this.activity = this.bound(data.activity, this.activity);
        // Turning activity off prevents future automatic strikes, not a current one.
        if (this.activity === 0) this.samplesUntilStrike = Infinity;
        else if (this.samplesUntilStrike === Infinity) this.samplesUntilStrike = Math.round(sampleRate * 3);
      } else if (data.type === 'trigger') {
        this.beginStrike();
      }
    };
  }

  bound(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
  }

  channelState() {
    return { low: 0, deep: 0, mid: 0, highs: 0, sub: 0, phase: Math.random() * Math.PI * 2 };
  }

  intervalFrames() {
    if (this.activity <= 0) return Infinity;
    const quiet = 1 - this.activity / 100;
    const seconds = 4 + quiet * 31 + Math.random() * (7 + quiet * 54);
    return Math.round(sampleRate * seconds);
  }

  beginStrike() {
    this.eventSamples = 0;
    this.eventLength = 5.5 + Math.random() * 6.0;
    this.eventStrength = 0.72 + Math.random() * 0.28;
    this.eventPan = (Math.random() - .5) * .38;
    this.bursts = [
      { time: 0, strength: 1, length: .65 },
      { time: .45 + Math.random() * .65, strength: .55 + Math.random() * .3, length: 1.2 },
      { time: 1.6 + Math.random() * 1.3, strength: .28 + Math.random() * .25, length: 1.8 },
      { time: 3.5 + Math.random() * 1.2, strength: .10 + Math.random() * .15, length: 1.5 }
    ];
    this.samplesUntilStrike = this.intervalFrames();
  }

  // Evaluated once per 128-sample block, not per sample.
  envelopeAt(seconds) {
    const distance = this.distance / 100;
    const onset = 0.025 + distance * 0.27;
    const rise = 1 - Math.exp(-seconds / onset);
    const dec = Math.exp(-seconds / (1.2 + distance * 2.3));
    let echoes = 0;
    for (const burst of this.bursts) {
      const local = seconds - burst.time;
      if (local > 0) {
        const attack = 1 - Math.exp(-local / (.025 + distance * .11));
        echoes += burst.strength * attack * Math.exp(-local / burst.length);
      }
    }
    // Close strikes are briefly bright and crackly, distant ones roll slowly.
    const crack = Math.exp(-seconds / (.028 + distance * .20)) * Math.pow(1 - distance, 2.3);
    const body = rise * (dec * .65 + echoes * .6);
    return { body: body * this.eventStrength, crack: crack * this.eventStrength };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const frames = output[0].length;
    if (this.eventLength === 0) {
      if (this.samplesUntilStrike !== Infinity) {
        this.samplesUntilStrike -= frames;
        if (this.samplesUntilStrike <= 0) this.beginStrike();
      }
      if (this.eventLength === 0) {
        output.forEach(channel => channel.fill(0));
        return true;
      }
    }

    const t = this.eventSamples / sampleRate;
    const { body, crack } = this.envelopeAt(t);
    const distance = this.distance / 100;
    // A distant thunderstorm has markedly less high-frequency energy.
    const presence = .12 + (1 - distance) * .52;
    const brightness = .03 + Math.pow(1 - distance, 2) * .65;
    const pan = this.eventPan;
    for (let c = 0; c < output.length; c++) {
      const samples = output[c];
      const s = this.channels[c] || this.channels[0];
      const stereo = c === 0 ? 1 - pan : 1 + pan;
      for (let i = 0; i < frames; i++) {
        const white = Math.random() * 2 - 1;
        // Several cascaded leaky low-pass filters produce coloured rumble.
        s.low += .040 * (white - s.low);
        s.deep += .016 * (s.low - s.deep);
        s.sub += .0032 * (s.deep - s.sub);
        s.mid += .19 * (white - s.mid);
        s.highs += .67 * (white - s.highs);
        s.phase += (2 * Math.PI * (31 + (1 - distance) * 10)) / sampleRate;
        if (s.phase > Math.PI * 2) s.phase -= Math.PI * 2;
        const sub = Math.sin(s.phase) * .025;
        const rolling = (s.deep * 9.5 + s.sub * 13 + sub) * body;
        const texture = (s.low * 1.5 + s.mid * presence) * body;
        const snap = (s.highs * brightness + s.mid * .15) * crack;
        // Soft saturation reduces occasional peaks before downstream compression.
        const y = (rolling + texture + snap) * stereo * .62;
        samples[i] = Math.tanh(y);
      }
    }
    this.eventSamples += frames;
    if (this.eventSamples >= this.eventLength * sampleRate) {
      this.eventSamples = 0;
      this.eventLength = 0;
    }
    return true;
  }
}

registerProcessor('static-thunder-source', ThunderProcessor);
