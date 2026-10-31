import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spliceRenderedAudio } from '../pcm-seam.js';

function white(seed, frames) {
  let state = seed >>> 0;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = (state >>> 0) / 0xffffffff * 2 - 1;
  }
  return out;
}

function rms(samples, start, end) {
  let power = 0;
  for (let i = start; i < end; i++) power += samples[i] ** 2;
  return Math.sqrt(power / (end - start));
}

test('crossfade joins original tail at start and incoming signal at its end', () => {
  const overlap = 100, frames = 400;
  const old = [new Float32Array(overlap).fill(.3), new Float32Array(overlap).fill(-.2)];
  const now = [new Float32Array(frames + overlap).fill(-.4), new Float32Array(frames + overlap).fill(.45)];
  const buffer = { numberOfChannels: 2, length: frames + overlap, getChannelData: c => now[c] };
  const {channels, tail} = spliceRenderedAudio(buffer, old, { outputFrames: frames, overlapFrames: overlap });
  assert.ok(Math.abs(channels[0][0] - .3) < 1e-6);
  assert.ok(Math.abs(channels[1][0] + .2) < 1e-6);
  assert.ok(Math.abs(channels[0][overlap - 1] + .4) < 1e-6);
  assert.ok(Math.abs(channels[1][overlap - 1] - .45) < 1e-6);
  assert.ok(Math.abs(channels[0][overlap] + .4) < 1e-6);
  assert.ok(Math.abs(channels[1][overlap] - .45) < 1e-6);
  assert.deepEqual([...tail[0]], [...now[0].slice(frames)]);
  assert.deepEqual([...tail[1]], [...now[1].slice(frames)]);
});

test('independent noise does not lose 3 dB RMS halfway through a segment join', () => {
  const outputFrames = 48000, overlapFrames = 24000;
  const oldTail = [white(101, overlapFrames), white(202, overlapFrames)];
  const channels = [white(303, outputFrames + overlapFrames), white(404, outputFrames + overlapFrames)];
  const buffer = {
    numberOfChannels: 2, length: outputFrames + overlapFrames,
    getChannelData: channel => channels[channel]
  };
  const joined = spliceRenderedAudio(buffer, oldTail, { outputFrames, overlapFrames });
  for (let channel = 0; channel < 2; channel++) {
    const result = joined.channels[channel];
    const baseline = rms(result, overlapFrames + 2000, outputFrames - 2000);
    const middle = rms(result, Math.round(overlapFrames * .5) - 4000, Math.round(overlapFrames * .5) + 4000);
    const dropDb = 20 * Math.log10(middle / baseline);
    // At the midpoint an equal-gain fade would be ~-3 dB for uncorrelated
    // noise. An equal-power fade should remain close to its normal level.
    assert.ok(Math.abs(dropDb) < .35,
      'Channel ' + channel + ' had a ' + dropDb.toFixed(2) + ' dB midpoint change');
  }
});

test('PCM seam input validation remains enforced', () => {
  const oldTail = [new Float32Array(5), new Float32Array(5)];
  const buffer = {
    numberOfChannels: 2,
    length: 32,
    getChannelData: () => new Float32Array(32)
  };
  assert.throws(() => spliceRenderedAudio(buffer, oldTail, { outputFrames: 16, overlapFrames: 4 }), /Incompatible/);
  assert.throws(() => spliceRenderedAudio(buffer, null, { outputFrames: 16, overlapFrames: 16 }), /Invalid/);
});
