import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function processorHarness(options = {}) {
  let Thunder;
  const context = {
    sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null }; } },
    registerProcessor(name, type) { if (name === 'static-thunder-source') Thunder = type; },
    Math, Number, Infinity
  };
  runInNewContext(readFileSync(new URL('../thunder-worklet.js', import.meta.url), 'utf8'),context);
  return new Thunder({processorOptions: options});
}

function processFrames(proc, frames) {
  const channel0 = new Float32Array(frames);
  const channel1 = new Float32Array(frames);
  proc.process([],[[channel0,channel1]]);
  return [channel0,channel1];
}

test('manual thunder generates finite, non-zero samples in audio worklet', () => {
  const proc=processorHarness({activity:0, distance:60});
  for(let i=0;i<300;i++) assert.equal(processFrames(proc,128)[0].every(n=>n===0),true);
  proc.port.onmessage({data:{type:'trigger'}});
  let peak=0, sum=0;
  for(let i=0;i<480;i++) {
    const [left,right] = processFrames(proc,128);
    for(const sample of left) { assert.ok(Number.isFinite(sample)); peak=Math.max(peak,Math.abs(sample)); sum+=sample*sample; }
    for(const sample of right) assert.ok(Number.isFinite(sample));
  }
  assert.ok(peak > .05,`peak=${peak}`);
  assert.ok(peak <= 1,`clipped=${peak}`);
  assert.ok(sum > 1,`sum=${sum}`);
});

test('activity 0 waits for a manual trigger; setting activity allows scheduling', () => {
  const proc=processorHarness({activity:0});
  assert.equal(proc.samplesUntilStrike,Infinity);
  proc.port.onmessage({data:{type:'settings',distance:100,activity:62}});
  assert.ok(proc.samplesUntilStrike > 0);
  proc.port.onmessage({data:{type:'settings',distance:-10,activity:120}});
  assert.equal(proc.distance,0);
  assert.equal(proc.activity,100);
});
