/*
 * Static: real-time procedural noise sources.
 * No assets, data connections or third-party code required.
 * Each processor creates independent left/right channel noise.
 */
class NoiseSourceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kind = options.processorOptions?.kind || 'white';
    this.channels = [this.makeState(), this.makeState()];
  }

  makeState() {
    return { brown: 0, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) {
      const samples = output[channel];
      const s = this.channels[channel] || this.channels[0];
      for (let i = 0; i < samples.length; i++) {
        const white = Math.random() * 2 - 1;
        let sample;
        switch (this.kind) {
          case 'pink': {
            // Paul Kellet's pink noise approximation (approximately -3 dB/octave).
            s.b0 = 0.99886 * s.b0 + white * 0.0555179;
            s.b1 = 0.99332 * s.b1 + white * 0.0750759;
            s.b2 = 0.96900 * s.b2 + white * 0.1538520;
            s.b3 = 0.86650 * s.b3 + white * 0.3104856;
            s.b4 = 0.55000 * s.b4 + white * 0.5329522;
            s.b5 = -0.7616 * s.b5 - white * 0.0168980;
            sample = (s.b0 + s.b1 + s.b2 + s.b3 + s.b4 + s.b5 + s.b6 + white * 0.5362) * 0.11;
            s.b6 = white * 0.115926;
            break;
          }
          case 'brown':
            // Leaky integral prevents unbounded DC drift; ~-6 dB/octave.
            s.brown = (s.brown + 0.02 * white) / 1.02;
            sample = s.brown * 3.5;
            break;
          default:
            sample = white;
        }
        samples[i] = sample;
      }
    }
    return true;
  }
}

registerProcessor('static-noise-source', NoiseSourceProcessor);
