import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { StreamPreparationGate, streamControlState } from '../stream-controls.js';

test('Stop stays enabled throughout a playing Opus stream extension', () => {
  assert.deepEqual(streamControlState({ preparing: true, playing: true, ready: true }), {
    prepareDisabled: true,
    extendDisabled: true,
    transportDisabled: false, // button remains Stop
    modeDisabled: true
  });
});

test('Play is blocked when preparing without playback, then restored afterwards', () => {
  assert.deepEqual(streamControlState({ preparing: true, playing: false, ready: true }), {
    prepareDisabled: true,
    extendDisabled: true,
    transportDisabled: true,
    modeDisabled: true
  });
  assert.deepEqual(streamControlState({ preparing: false, playing: false, ready: true }), {
    prepareDisabled: false,
    extendDisabled: false,
    transportDisabled: false,
    modeDisabled: false
  });
});

test('adjusting volume and rerendering cannot re-enable Add while preparing', () => {
  const gate = new StreamPreparationGate();
  let release;
  const ongoing = gate.run(() => new Promise(resolve => { release = resolve; }));
  assert.equal(gate.active, true);
  // Simulate a volume change: the stream is still ready, but preparation is running.
  for (let i = 0; i < 5; i++) {
    const flags = streamControlState({ preparing: gate.active, playing: true, ready: true });
    assert.equal(flags.extendDisabled, true);
    assert.equal(flags.transportDisabled, false);
  }
  release();
  return ongoing.then(() => assert.equal(gate.active, false));
});

test('overlapping preparation request does not execute or release active preparation', async () => {
  const gate = new StreamPreparationGate();
  let finish;
  let calls = 0;
  const first = gate.run(async () => {
    calls++;
    await new Promise(resolve => { finish = resolve; });
  });
  const duplicate = await gate.run(async () => { calls++; });
  assert.equal(duplicate, false);
  assert.equal(calls, 1);
  assert.equal(gate.active, true);
  finish();
  assert.equal(await first, true);
  assert.equal(gate.active, false);
  assert.equal(await gate.run(async () => { calls++; }), true);
  assert.equal(calls, 2);
});

test('failed preparation always releases the exclusive gate', async () => {
  const gate = new StreamPreparationGate();
  await assert.rejects(gate.run(async () => { throw new Error('render failed'); }), /render failed/);
  assert.equal(gate.active, false);
  assert.equal(await gate.run(async () => {}), true);
});
