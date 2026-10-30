/*
 * Two output paths for the same synthesised sound.
 *
 * 'media' feeds an HTMLAudioElement from Web Audio. Chromium may treat this as
 * active background media, unlike a graph routed directly to the speakers.
 * This is experimental on Android and does not guarantee lock-screen playback.
 * 'direct' keeps the original v4 output for A/B comparisons.
 */
export const OUTPUT_MODES = Object.freeze(['media', 'direct']);

export class AudioOutputRoute {
  constructor(context, master, createElement = () => document.createElement('audio')) {
    this.context = context;
    this.master = master;
    this.destination = context.createMediaStreamDestination();
    this.element = createElement();
    this.element.autoplay = false;
    this.element.controls = false;
    this.element.playsInline = true;
    this.element.setAttribute?.('aria-hidden', 'true');
    this.element.srcObject = this.destination.stream;
    // Keep a media element in the page for Android's media session handling.
    if (typeof document !== 'undefined' && document.body && !this.element.parentNode) {
      this.element.hidden = true;
      document.body.append(this.element);
    }
    this.mode = null;
  }

  // Only change output while playback is stopped; never connect both sinks.
  setMode(mode) {
    if (!OUTPUT_MODES.includes(mode)) throw new Error('Unknown audio output mode');
    if (this.mode === mode) return;
    this.element.pause();
    this.master.disconnect();
    this.master.connect(mode === 'media' ? this.destination : this.context.destination);
    this.mode = mode;
  }

  async play() {
    if (this.mode === 'media') await this.element.play();
  }

  pause() { this.element.pause(); }

  getStatus() {
    return { mode: this.mode, mediaPaused: this.element.paused };
  }
}
