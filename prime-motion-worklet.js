import { PrimeMotion } from './prime-motion-core.js';

// Two mono outputs control gain intensity and filter frequency, respectively.
// Audio-rate parameters receive smoothly interpolated low-frequency values.
class PrimeMotionProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.motion = new PrimeMotion(options.processorOptions || {});
    this.previous = this.motion.read();
  }

  process(inputs, outputs) {
    const gain = outputs[0]?.[0];
    const colour = outputs[1]?.[0];
    if (!gain || !colour) return true;
    const n = gain.length;
    const next = this.motion.advance(n / sampleRate);
    // Linear interpolation avoids block-edge clicks, even on frequency sweeps.
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n;
      gain[i] = this.previous.strength + (next.strength - this.previous.strength) * t;
      colour[i] = this.previous.colour + (next.colour - this.previous.colour) * t;
    }
    this.previous = next;
    return true;
  }
}

registerProcessor('static-prime-motion', PrimeMotionProcessor);
