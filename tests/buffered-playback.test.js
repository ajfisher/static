import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { encodeLoopedWav, soundFingerprint, BUFFER_SECONDS } from '../buffered-render.js';
import { BufferedPlayback } from '../buffered-playback.js';

function sampleBuffer({ rate = 8000, length = 120, left = 0.5, right = -0.25 } = {}) {
  const data = [
    Float32Array.from({ length }, (_, i) => typeof left === 'function' ? left(i) : left),
    Float32Array.from({ length }, (_, i) => typeof right === 'function' ? right(i) : right)
  ];
  return { sampleRate: rate, numberOfChannels: 2, length, getChannelData: ch => data[ch] };
}

function fakePlayer() {
  let serial = 0;
  const urls = [];
  const revoked = [];
  const audio = {
    paused: true,
    loop: false,
    preload: null,
    hidden: false,
    currentTime: 0,
    volume: 1,
    setAttribute() {},
    load() {},
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  };
  const data = { mix: { pink: 58 }, eq: { pink: [2, 0, -2, 0, -1] }, storm: { distance: 71, activity: 50 } };
  const player = new BufferedPlayback({
    createElement: () => audio,
    render: async () => new ArrayBuffer(88),
    createObjectURL: () => { const url = 'blob:test-' + ++serial; urls.push(url); return url; },
    revokeObjectURL: url => revoked.push(url)
  });
  return { player, audio, urls, revoked, data };
}

test('WAV encoding writes a valid 16-bit stereo RIFF header', () => {
  const result = encodeLoopedWav(sampleBuffer(), { durationSeconds: .01, crossfadeSeconds: .002 });
  const view = new DataView(result);
  const text = (offset, n) => String.fromCharCode(...new Uint8Array(result, offset, n));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(12, 4), 'fmt ');
  assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 80 * 4);
  assert.equal(result.byteLength, 44 + 80 * 4);
  assert.equal(BUFFER_SECONDS, 120);
});

test('loop crossfade joins original material beyond the loop boundary', () => {
  const buffer = sampleBuffer({
    left: i => i < 80 ? .6 : -.7,
    right: i => i < 80 ? -.1 : .3
  });
  const view = new DataView(encodeLoopedWav(buffer, {
    durationSeconds: .01, crossfadeSeconds: .002
  }));
  assert.ok(Math.abs(view.getInt16(44, true) / 32768 + .7) < .002);
  assert.ok(Math.abs(view.getInt16(46, true) / 32767 - .3) < .002);
  assert.ok(Math.abs(view.getInt16(44 + 15 * 4, true) / 32767 - .6) < .002);
  assert.ok(Math.abs(view.getInt16(44 + 16 * 4, true) / 32767 - .6) < .002);
});

test('WAV encoder clips out of range audio and rejects invalid samples', () => {
  const buffer = sampleBuffer({ left: 3, right: -8 });
  const wav = new DataView(encodeLoopedWav(buffer, { durationSeconds: .01, crossfadeSeconds: .002 }));
  assert.equal(wav.getInt16(44, true), 32767);
  assert.equal(wav.getInt16(46, true), -32768);
  assert.throws(() => encodeLoopedWav(buffer, { durationSeconds: 2, crossfadeSeconds: 1 }), /Invalid audio buffer/);
});

test('fingerprint ignores master volume, includes EQ, mix and storm', () => {
  const source = { mix: { pink: 60 }, eq: { pink: [0, 2] }, storm: { activity: 45, distance: 73 }, level: 30 };
  const key = soundFingerprint(source);
  assert.equal(key, soundFingerprint({ ...source, level: 80 }));
  assert.notEqual(key, soundFingerprint({ ...source, mix: { pink: 61 } }));
  assert.notEqual(key, soundFingerprint({ ...source, eq: { pink: [1, 2] } }));
  assert.notEqual(key, soundFingerprint({ ...source, storm: { activity: 55, distance: 73 } }));
});

test('buffered player prepares, plays, marks stale mixes and revokes old URL', async () => {
  const { player, audio, urls, revoked, data } = fakePlayer();
  assert.equal(player.isReady(data), false);
  await assert.rejects(async () => player.play(data), /Prepare/);
  const first = await player.prepare(data);
  assert.equal(first.bytes, 88);
  assert.equal(player.isReady(data), true);
  assert.equal(audio.loop, true);
  await player.play(data);
  assert.equal(audio.paused, false);
  assert.equal(player.isReady({ ...data, mix: { pink: 59 } }), false);
  player.stop();
  await player.prepare({ ...data, mix: { pink: 59 } });
  assert.equal(urls.length, 2);
  assert.deepEqual(revoked, [urls[0]]);
  player.setLevel(37);
  assert.ok(audio.volume > 0 && audio.volume < 1);
  player.dispose();
  assert.deepEqual(revoked, urls);
});

test('failure to prepare does not erase last valid buffered sound', async () => {
  const { player, data } = fakePlayer();
  await player.prepare(data);
  player.render = async () => { throw new Error('offline worklet failure'); };
  await assert.rejects(player.prepare({ ...data, mix: { pink: 3 } }), /offline worklet failure/);
  assert.equal(player.isReady(data), true);
  assert.equal(player.getStatus().preparing, false);
});
