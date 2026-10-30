/* Encode a continuous stream of planar float32 frames into raw Opus packets.
 * One AudioEncoder is reused across render chunks to avoid mid-stream resets.
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
    this.encoder = new AudioEncoderClass({
      output: packet => {
        const bytes = new Uint8Array(packet.byteLength);
        packet.copyTo(bytes);
        this.packets.push({timestamp: packet.timestamp, duration: packet.duration || 20000, data: bytes});
      },
      error: err => { this.fatal = err; }
    });
    this.encoder.configure({codec: 'opus', sampleRate: OPUS_RATE,
      numberOfChannels: OPUS_CHANNELS, bitrate: OPUS_BITRATE});
  }

  // Called only with an OfflineAudioContext result resampled/rendered at 48k.
  async encodeBuffer(channelData, { yieldEvery = 64 } = {}) {
    if (channelData.length !== 2 || channelData[0].length !== channelData[1].length) {
      throw new Error('Expected two equally-sized PCM channels');
    }
    const totalFrames = channelData[0].length;
    if (totalFrames % OPUS_FRAME_SAMPLES) throw new Error('PCM frames must align to Opus frames');
    const first = this.packets.length;
    for (let offset = 0, index = 0; offset < totalFrames; offset += OPUS_FRAME_SAMPLES, index++) {
      if (this.fatal) throw this.fatal;
      const frame = new Float32Array(OPUS_FRAME_SAMPLES * 2);
      frame.set(channelData[0].subarray(offset, offset + OPUS_FRAME_SAMPLES), 0);
      frame.set(channelData[1].subarray(offset, offset + OPUS_FRAME_SAMPLES), OPUS_FRAME_SAMPLES);
      const audio = new this.AudioDataClass({
        format: 'f32-planar', sampleRate: OPUS_RATE,
        numberOfFrames: OPUS_FRAME_SAMPLES, numberOfChannels: OPUS_CHANNELS,
        timestamp: Math.round(this.sampleCursor * 1000000 / OPUS_RATE), data: frame
      });
      this.encoder.encode(audio);
      audio.close();
      this.sampleCursor += OPUS_FRAME_SAMPLES;
      if (index && index % yieldEvery === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    await this.encoder.flush();
    if (this.fatal) throw this.fatal;
    return this.packets.slice(first);
  }

  close() { if (this.encoder.state !== 'closed') this.encoder.close(); }
}