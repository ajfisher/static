/*
 * Slowly evolving, deterministic control envelopes for synthetic environments.
 * The source is deliberately periodic at several prime-number periods, with
 * slow bounded cadence drift and smoothed stochastic variation to prevent a
 * recognisable composite loop. Pure JS for use in the AudioWorklet and tests.
 *
 * Outputs: strength 0..1 for gain modulation, colour -1..1 for filter motion.
 */
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class PrimeMotion {
  constructor({ periods = [11, 17, 29], style = 'waves', seed = 1 } = {}) {
    if (!Array.isArray(periods) || periods.length !== 3 || periods.some(p => !Number.isFinite(p) || p <= 1)) {
      throw new Error('Three valid modulation periods are required');
    }
    this.periods = [...periods];
    this.style = style;
    this.seed = (seed >>> 0) || 0x1936f5c7;
    this.phases = periods.map(() => this.random() * TAU);
    this.drifts = periods.map(() => 0);
    this.driftTargets = periods.map(() => 0);
    this.driftNext = periods.map((_, i) => 8 + this.random() * (8 + i * 5));
    this.time = 0;
    this.slow = 0;
    this.slowTarget = this.random() * 2 - 1;
    this.slowNext = 2 + this.random() * 4;
  }

  // Xorshift32 provides reproducible tests without any external state.
  random() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return this.read();
    // Short increments are supplied by the audio block renderer.
    const dt = Math.min(seconds, 0.1);
    this.time += dt;
    for (let i = 0; i < this.periods.length; i++) {
      if (this.time >= this.driftNext[i]) {
        this.driftTargets[i] = (this.random() * 2 - 1) * (this.style === 'waves' ? .115 : .085);
        this.driftNext[i] = this.time + 9 + this.random() * (12 + i * 6);
      }
      // Drift changes over several seconds, rather than abruptly adjusting speed.
      this.drifts[i] += (this.driftTargets[i] - this.drifts[i]) * (1 - Math.exp(-dt / 9));
      const frequency = 1 / (this.periods[i] * (1 + this.drifts[i]));
      this.phases[i] = (this.phases[i] + TAU * dt * frequency) % TAU;
    }
    if (this.time >= this.slowNext) {
      this.slowTarget = this.random() * 2 - 1;
      this.slowNext = this.time + (this.style === 'waves' ? 5 : 2) + this.random() * 5;
    }
    this.slow += (this.slowTarget - this.slow) * (1 - Math.exp(-dt / (this.style === 'waves' ? 4.5 : 2.8)));
    return this.read();
  }

  read() {
    const p = this.phases;
    if (this.style === 'waves') {
      // Three overlapping swells. All periods are prime-numbered seconds.
      // A slightly delayed colour envelope mimics a wash following the swell.
      const crest = angle => Math.pow((1 + Math.sin(angle)) * .5, 2.3);
      const shape = .46 * crest(p[0]) + .34 * crest(p[1]) + .20 * crest(p[2]);
      const wash = .46 * crest(p[0] - .48) + .34 * crest(p[1] - .32) + .20 * crest(p[2] - .55);
      const strength = clamp(shape * (1 + this.slow * .13) + this.slow * .035, 0, 1);
      const colour = clamp(2 * wash - 1 + this.slow * .14, -1, 1);
      return { strength, colour };
    }
    // Rain should drift in intensity but should never pump or sound like surf.
    const intensity = .44 * Math.sin(p[0]) + .33 * Math.sin(p[1]) + .23 * Math.sin(p[2]);
    const spectral = .44 * Math.sin(p[0] - .3) + .33 * Math.sin(p[1] + .2) + .23 * Math.sin(p[2] - .4);
    return {
      strength: clamp(.5 + .46 * intensity + .09 * this.slow, 0, 1),
      colour: clamp(spectral * .85 + this.slow * .12, -1, 1)
    };
  }
}
