import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { OpusMsePlayer } from '../opus-stream.js';

const sound = { mix: { pink: 72 }, eq: { pink: [0, 0, 0, 0, 0] }, storm: { distance: 72, activity: 45 } };
const silentChannel = new Float32Array(32 * 48000);
const raw = {
  numberOfChannels: 2, length: silentChannel.length,
  getChannelData: () => silentChannel
};

function makeMediaSource(failOnAppend = 0) {
  let appendCalls = 0;
  const listeners = new Map();
  const source = {
    readyState: 'open', ends: 0,
    addEventListener() {},
    endOfStream() { this.ends++; this.readyState = 'ended'; },
    addSourceBuffer() { return buffer; }
  };
  const buffer = {
    mode: 'segments', updating: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    appendBuffer() {
      appendCalls++;
      if (appendCalls === failOnAppend) throw new Error('append failure');
      if (source.readyState === 'ended') source.readyState = 'open';
      queueMicrotask(() => listeners.get('updateend')?.());
    }
  };
  return source;
}

async function withPlayer(failure, run) {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalSupported = OpusMsePlayer.supported;
  let sourceCount = 0, renderCalls = 0, encoderCalls = 0, codecClosed = 0, urlCount = 0;
  const revoked = [];
  URL.createObjectURL = () => 'blob:mock-' + ++urlCount;
  URL.revokeObjectURL = url => revoked.push(url);
  OpusMsePlayer.supported = async () => true;
  const audio = {
    paused: true, buffered: { length: 0 }, controls: false,
    setAttribute() {}, load() {}, remove() {},
    removeAttribute(name) { if (name === 'src') delete this.src; },
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); }
  };
  let packetTimestamp = 0;
  const player = new OpusMsePlayer({
    createElement: () => audio,
    mediaSourceFactory: () => makeMediaSource(failure === 'append' && ++sourceCount === 1 ? 2 : 0),
    render: async () => {
      renderCalls++;
      if (failure === 'render' && renderCalls === 1) throw new Error('render failure');
      return raw;
    },
    encoderFactory: () => ({
      async encodeBuffer() {
        encoderCalls++;
        if (failure === 'encode' && encoderCalls === 1) throw new Error('encode failure');
        const packet = { timestamp: packetTimestamp, duration: 20000, data: Uint8Array.of(0xf8, 0, 0) };
        packetTimestamp += 30000000;
        return [packet];
      },
      close() { codecClosed++; }
    })
  });
  try {
    await run({ player, audio, revoked, getStats: () => ({ sourceCount, renderCalls, encoderCalls, codecClosed, urlCount }) });
  } finally {
    player.dispose();
    OpusMsePlayer.supported = originalSupported;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
}

for (const failure of ['render', 'encode', 'append']) {
  test('initial ' + failure + ' failure allows Prepare retry with unchanged sound', async () => {
    await withPlayer(failure, async ({ player, audio, revoked, getStats }) => {
      await assert.rejects(player.prepare(sound, 1), new RegExp(failure + ' failure'));
      assert.equal(player.mediaSource, null, 'failed MediaSource released');
      assert.equal(player.encoder, null, 'failed encoder released');
      assert.equal(player.soundKey, null, 'initial mix fingerprint cleared');
      assert.equal(player.seconds, 0);
      assert.equal(player.preparing, false);
      assert.equal(audio.src, undefined, 'failed object URL detached');
      assert.equal(revoked.length, 1, 'failed blob URL revoked');
      assert.equal(getStats().codecClosed, 1, 'encoder closed if it was created');
      // The same player must be reusable; no preset edits or page reload.
      const status = await player.prepare(sound, 1);
      assert.equal(status.seconds, 60);
      assert.equal(player.isReady(sound), true);
      assert.equal(player.mediaSource.readyState, 'ended');
      assert.equal(getStats().urlCount, 2);
    });
  });
}
