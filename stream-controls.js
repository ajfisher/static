/**
 * A single owner for the async Opus preparation operation.
 * Reject overlapping attempts without resetting the first operation's state.
 */
export class StreamPreparationGate {
  constructor() { this.active = false; }

  async run(work) {
    if (this.active) return false;
    this.active = true;
    try {
      await work();
      return true;
    } finally {
      this.active = false;
    }
  }
}

/**
 * Pure control-state calculation used by every stream UI render.
 * A running stream must always retain Stop during an extension.
 */
export function streamControlState({
  preparing = false,
  playing = false,
  ready = false,
  transportBusy = false
} = {}) {
  return {
    prepareDisabled: preparing || playing,
    extendDisabled: preparing || !ready,
    transportDisabled: transportBusy || (preparing && !playing),
    modeDisabled: preparing || playing
  };
}
