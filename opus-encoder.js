/* Encode a continuous stream of planar float32 frames into raw Opus packets.
 * Keep one AudioEncoder alive across successive PCM chunks. In Chromium,
 * flush() pads the final frame and resets Opus timestamp tracking, so it must
 * NOT run at an ordinary chunk boundary.
 */
export const OPUS_RATE = 48000;
export const OPUS_CHANNELS = 2;
export const OPUS_BITRATE = 128000;
export const OPUS_FRAME_SAMPLES = 960; // 20 ms at 48 kHz

export async function opusAvailable({ AudioEncoderClass = globalThis.AudioEncoder, MediaSourceClass = globalThis.MediaSource } = {}) {
  if (!AudioEncoderClass || !globalThis.AudioData || !MediaSourceClass?.isTypeSupported?.('audio/webm; codecs="opus"')) return false;
  try {
    return !!(await AudioEncoderClass.isConfigSupported({
      codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: OPUS_CHANNELS, bitrate: OPUS_BITRATE
    })).supported;
  } catch (_) { return false; }
}

export class OpusStreamEncoder {
  constructor({ AudioEncoderClass = globalThis.AudioEncoder, AudioDataClass = globalThis.AudioData } = {}) {
    if (!AudioEncoderClass || !AudioDataClass) throw new Error('WebCodecs AudioEncoder and AudioData are required');
    this.AudioDataClass = AudioDataClass;
    this.packets = [];
    this.sampleCursor = 0;
    this.fatal = null;
    this.waiters = new Set();
    this.encoder = new AudioEncoderClass({
      output: packet => {
        const bytes = new Uint8Array(packet.byteLength);
        packet.copyTo(bytes);
        this.packets.push({timestamp: packet.timestamp, duration: packet.duration || 20000, data: bytes});
        this.notify();
      },
      error: err => {
        this.fatal = err;
        this.notify();
      }
    });
    // AudioEncoder.dequeue means the input queue has accepted work. It does
    // not promise that every delayed Opus packet has already been emitted.
    this.encoder.addEventListener?.('dequeue', () => this.notify());
    this.encoder.configure({codec: 'opus', sampleRate: OPUS_RATE,
      numberOfChannels: OPUS_CHANNELS, bitrate: OPUS_BITRATE});
  }

  notify() {
    for (const waiter of [...this.waiters]) waiter();
  }

  async waitFor(predicate, label) {
    if (this.fatal) throw this.fatal;
    if (predicate()) return;
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timeout);
        this.waiters.delete(check);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (this.fatal) finish(this.fatal);
        else if (this.encoder.state === 'closed') finish(new Error('Opus encoder closed'));
        else if (predicate()) finish();
      };
      const timeout = setTimeout(() => finish(new Error('Opus encoder timed out: ' + label)), 30000);
      this.waiters.add(check);
      check(); // closes the race with a dequeue event before registration
    });
  }

  // Called with successive 48-kHz stereo OfflineAudioContext results.
  // Returned packets are whichever complete packets the codec has emitted so
  // far. A lookahead packet may arrive during the NEXT call and will be
  // returned there; it is never padded or dropped at the PCM boundary.
  async encodeBuffer(channelData, { maxQueueSize = 32 } = {}) {
    if (channelData.length !== 2 || channelData[0].length !== channelData[1].length) {
      throw new Error('Expected two equally-sized PCM channels');
    }
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 2) throw new Error('Invalid encoder queue size');
    const totalFrames = channelData[0].length;
    if (totalFrames % OPUS_FRAME_SAMPLES) throw new Error('PCM frames must align to Opus frames');
    for (let offset = 0; offset < totalFrames; offset += OPUS_FRAME_SAMPLES) {
      await this.waitFor(() => this.encoder.encodeQueueSize < maxQueueSize, 'backpressure');
      if (this.fatal) throw this.fatal;
      const frame = new Float32Array(OPUS_FRAME_SAMPLES * 2);
      frame.set(channelData[0].subarray(offset, offset + OPUS_FRAME_SAMPLES), 0);
      frame.set(channelData[1].subarray(offset, offset + OPUS_FRAME_SAMPLES), OPUS_FRAME_SAMPLES);
      const audio = new this.AudioDataClass({
        format: 'f32-planar', sampleRate: OPUS_RATE,
        numberOfFrames: OPUS_FRAME_SAMPLES, numberOfChannels: OPUS_CHANNELS,
        timestamp: Math.round(this.sampleCursor * 1000000 / OPUS_RATE), data: frame
      });
      try { this.encoder.encode(audio); } finally { audio.close(); }
      this.sampleCursor += OPUS_FRAME_SAMPLES;
    }
    await this.waitFor(() => this.encoder.encodeQueueSize === 0, 'drain');
    // A dequeue event can precede the output callback. Give completed codec
    // work a task turn to deliver packets, but do not call flush().
    await new Promise(resolve => setTimeout(resolve, 0));
    if (this.fatal) throw this.fatal;
    return this.packets.splice(0);
  }

  close() {
    if (this.encoder.state !== 'closed') this.encoder.close();
    this.notify();
  }
}
