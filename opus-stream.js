/* Offline synthetic generation -> continuous WebCodecs Opus -> MSE clusters.
 * Rendering happens ahead of playback; no live Web Audio is needed while locked.
 */
import { renderOfflineAudio, soundFingerprint } from './buffered-render.js';
import { OPUS_RATE, opusAvailable, OpusStreamEncoder } from './opus-encoder.js';
import { webmInitSegment, packetClusters } from './webm-opus.js';
import { spliceRenderedAudio } from './pcm-seam.js';

export const STREAM_CHUNK_SECONDS = 30;
export const STREAM_OVERLAP_SECONDS = 2;
export const STREAM_MIME = 'audio/webm; codecs="opus"';

export class OpusMsePlayer {
  constructor({ render = renderOfflineAudio, mediaSourceFactory = () => new MediaSource(),
    createElement = () => document.createElement('audio'), encoderFactory = () => new OpusStreamEncoder(),
    onProgress = () => {} } = {}) {
    this.render = render;
    this.mediaSourceFactory = mediaSourceFactory;
    this.createElement = createElement;
    this.encoderFactory = encoderFactory;
    this.onProgress = onProgress;
    this.audio = createElement();
    this.audio.controls = false;
    this.audio.preload = 'auto';
    this.audio.hidden = true;
    this.audio.setAttribute?.('aria-hidden', 'true');
    if (typeof document !== 'undefined' && document.body && !this.audio.parentNode) document.body.append(this.audio);
    this.encoder = null;
    this.mediaSource = null;
    this.buffer = null;
    this.url = null;
    this.soundKey = null;
    this.tail = null;
    this.preparing = false;
    this.seconds = 0;
    this.bytes = 0;
    this.firstTimestamp = null;
    this.appendedClusters = 0;
    this.disposed = false;
  }

  static async supported() { return opusAvailable(); }

  getStatus() {
    return {ready: this.seconds > 0, preparing: this.preparing, seconds: this.seconds,
      bytes: this.bytes, appendedClusters: this.appendedClusters,
      paused: this.audio.paused,
      bufferedSeconds: this.audio.buffered?.length
        ? this.audio.buffered.end(this.audio.buffered.length - 1) : 0};
  }

  isReady(sound) { return this.seconds > 0 && this.soundKey === soundFingerprint(sound); }

  async open(sound) {
    if (this.mediaSource) throw new Error('Stream already opened');
    if (!(await OpusMsePlayer.supported())) throw new Error('Opus WebCodecs or WebM MediaSource unsupported on this device');
    this.mediaSource = this.mediaSourceFactory();
    this.url = URL.createObjectURL(this.mediaSource);
    this.audio.src = this.url;
    await new Promise((resolve, reject) => {
      if (this.mediaSource.readyState === 'open') return resolve();
      this.mediaSource.addEventListener('sourceopen', resolve, {once:true});
      this.mediaSource.addEventListener('error', () => reject(new Error('MediaSource failed to open')), {once:true});
    });
    this.buffer = this.mediaSource.addSourceBuffer(STREAM_MIME);
    this.buffer.mode = 'segments';
    await this.append(webmInitSegment());
    this.encoder = this.encoderFactory();
    this.soundKey = soundFingerprint(sound);
  }

  append(bytes) {
    if (!this.buffer) throw new Error('SourceBuffer not open');
    return new Promise((resolve, reject) => {
      const source = this.buffer;
      const error = () => { cleanup(); reject(new Error('Could not append Opus WebM segment')); };
      const update = () => { cleanup(); resolve(); };
      const cleanup = () => {source.removeEventListener('updateend',update);source.removeEventListener('error',error)};
      source.addEventListener('updateend',update);
      source.addEventListener('error',error);
      try { source.appendBuffer(bytes); } catch (e) { cleanup(); reject(e); }
    });
  }

  // endOfStream() gives the HTML media element a finite duration and enables
  // its normal "ended" event when prepared audio runs out. The MSE spec
  // explicitly permits a later appendBuffer() to reopen an ended MediaSource.
  sealPrepared() {
    if (this.mediaSource?.readyState === 'open') {
      if (this.buffer?.updating) throw new Error('Cannot finalise while SourceBuffer is updating');
      this.mediaSource.endOfStream();
    }
  }

  // Do not destroy the audio element. Resetting its media source permits a
  // second Prepare after a failure on the very first chunk, with the same mix.
  resetFailedInitial() {
    try { this.encoder?.close(); } catch (_) { /* preserve original error */ }
    this.encoder = null;
    try { this.audio.pause(); } catch (_) {}
    this.audio.removeAttribute?.('src');
    this.audio.load?.();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.mediaSource = null;
    this.buffer = null;
    this.soundKey = null;
    this.tail = null;
    this.firstTimestamp = null;
    this.bytes = 0;
    this.appendedClusters = 0;
    this.seconds = 0;
  }

  async prepare(sound, minutes = 3) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 15) throw new Error('Choose 1 to 15 minutes');
    if (this.preparing) throw new Error('Stream preparation already in progress');
    if (this.disposed) throw new Error('Stream was discarded');
    if (this.mediaSource && !this.isReady(sound)) throw new Error('Mix changed; stop and start a new stream');
    this.preparing = true;
    try {
      if (!this.mediaSource) await this.open(sound);
      // Keep snapshot constant while generating a coherent sequence.
      const chunks = minutes * 60 / STREAM_CHUNK_SECONDS;
      const outputFrames = STREAM_CHUNK_SECONDS * OPUS_RATE;
      const overlapFrames = STREAM_OVERLAP_SECONDS * OPUS_RATE;
      for (let i = 0; i < chunks; i++) {
        if (this.disposed) throw new Error('Stream was discarded');
        const raw = await this.render(sound, {
          durationSeconds: STREAM_CHUNK_SECONDS, sampleRate: OPUS_RATE,
          crossfadeSeconds: STREAM_OVERLAP_SECONDS
        });
        const {channels, tail} = spliceRenderedAudio(raw, this.tail, {outputFrames, overlapFrames});
        // Only update continuity after both encoding and append succeed.
        const packets = await this.encoder.encodeBuffer(channels);
        if (!packets.length) throw new Error('Opus encoder returned no packets');
        if (this.firstTimestamp === null) this.firstTimestamp = packets[0].timestamp;
        for (const cluster of packetClusters(packets, {maxMilliseconds: 5000, originUs: this.firstTimestamp})) {
          await this.append(cluster);
          this.bytes += cluster.byteLength;
          this.appendedClusters++;
        }
        this.tail = tail;
        this.seconds += STREAM_CHUNK_SECONDS;
        this.onProgress(this.getStatus());
      }
      this.sealPrepared();
      return this.getStatus();
    } catch (error) {
      if (this.seconds === 0) {
        // Failed after the init segment but before one complete audio chunk.
        // Release the broken media source and encoder so the same mix can be
        // prepared again without changing settings or reloading the page.
        try { this.resetFailedInitial(); } catch (_) { /* preserve error */ }
      } else {
        // Earlier chunks remain playable even if an extension fails.
        try { this.sealPrepared(); } catch (_) { /* preserve error */ }
      }
      throw error;
    } finally { this.preparing = false; }
  }

  play(sound) {
    if (!this.isReady(sound)) throw new Error('Prepare this mix for stream playback first');
    return this.audio.play();
  }

  stop() { this.audio.pause(); try { this.audio.currentTime = 0; } catch (_) {} }

  setLevel(level) {
    const n = Math.max(0,Math.min(100, Number(level)||0));
    this.audio.volume = .58 * Math.pow(n/100,1.65);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.encoder?.close();
    this.encoder = null;
    this.audio.removeAttribute?.('src');
    this.audio.load?.();
    if(this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.mediaSource = null;
    this.buffer = null;
    this.audio.remove?.();
  }
}