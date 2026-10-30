import { renderOfflineMix, soundFingerprint } from './buffered-render.js';

// A normal HTML audio element is the only active sound source during playback.
// The AudioWorklet graph is used during Prepare, then discarded.
export class BufferedPlayback {
  constructor({
    render = renderOfflineMix,
    createElement = () => document.createElement('audio'),
    createObjectURL = blob => URL.createObjectURL(blob),
    revokeObjectURL = url => URL.revokeObjectURL(url)
  } = {}) {
    this.render = render;
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
    this.audio = createElement();
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.controls = false;
    this.audio.hidden = true;
    this.audio.setAttribute?.('aria-hidden', 'true');
    if (typeof document !== 'undefined' && document.body && !this.audio.parentNode) {
      document.body.append(this.audio);
    }
    this.key = null;
    this.url = null;
    this.preparing = false;
    this.bytes = 0;
  }

  isReady(sound) {
    return !!this.url && this.key === soundFingerprint(sound);
  }

  async prepare(sound) {
    if (this.preparing) throw new Error('Audio preparation already in progress');
    if (!this.audio.paused) throw new Error('Stop playback before preparing');
    this.preparing = true;
    try {
      const bytes = await this.render(sound);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const next = this.createObjectURL(blob);
      const previous = this.url;
      this.audio.src = next;
      this.audio.load?.();
      this.url = next;
      this.key = soundFingerprint(sound);
      this.bytes = blob.size;
      if (previous) this.revokeObjectURL(previous);
      return { bytes: this.bytes };
    } finally {
      this.preparing = false;
    }
  }

  // Must be invoked in the Play click call stack after a completed Prepare.
  play(sound) {
    if (!this.isReady(sound)) throw new Error('Prepare this sound before playing buffered audio');
    return this.audio.play();
  }

  stop() {
    this.audio.pause();
    try { this.audio.currentTime = 0; } catch (_) { /* media may not have loaded */ }
  }

  setLevel(level) {
    const n = Math.max(0, Math.min(100, Number(level) || 0));
    this.audio.volume = 0.58 * Math.pow(n / 100, 1.65);
  }

  getStatus() {
    return {
      ready: !!this.url,
      preparing: this.preparing,
      paused: this.audio.paused,
      bytes: this.bytes
    };
  }

  dispose() {
    this.stop();
    if (this.url) this.revokeObjectURL(this.url);
    this.url = null;
    this.key = null;
    this.audio.removeAttribute?.('src');
    this.audio.remove?.();
  }
}
