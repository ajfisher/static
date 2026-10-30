import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { AudioOutputRoute, OUTPUT_MODES } from '../audio-output.js';

function makeRoute() {
  const connected = [];
  let disconnected = 0;
  let plays = 0;
  let pauses = 0;
  const element = {
    paused: true,
    setAttribute() {},
    async play() { plays++; this.paused = false; },
    pause() { pauses++; this.paused = true; }
  };
  const destination = { stream: { kind: 'audio-stream' } };
  const context = { destination: { kind: 'speakers' }, createMediaStreamDestination() { return destination; } };
  const master = { connect(to) { connected.push(to); }, disconnect() { disconnected++; } };
  const route = new AudioOutputRoute(context, master, () => element);
  return { route, context, destination, element, connected, getCalls: () => ({ disconnected, plays, pauses }) };
}

test('media output attaches synthetic Web Audio stream to a real media player', async () => {
  const { route, destination, element, connected, getCalls } = makeRoute();
  assert.deepEqual(OUTPUT_MODES, ['media', 'direct']);
  assert.equal(element.srcObject, destination.stream);
  route.setMode('media');
  assert.deepEqual(connected, [destination]);
  await route.play();
  assert.equal(element.paused, false);
  assert.equal(getCalls().plays, 1);
  route.pause();
  assert.equal(element.paused, true);
});

test('direct mode sends audio to speakers without playing the HTML media element', async () => {
  const { route, context, connected, getCalls } = makeRoute();
  route.setMode('direct');
  await route.play();
  assert.deepEqual(connected, [context.destination]);
  assert.equal(getCalls().plays, 0);
  assert.equal(route.getStatus().mode, 'direct');
});

test('switching output never connects both destinations and rejects unknown modes', async () => {
  const { route, context, destination, connected, element, getCalls } = makeRoute();
  route.setMode('media');
  route.setMode('direct');
  route.setMode('media');
  assert.deepEqual(connected, [destination, context.destination, destination]);
  assert.equal(getCalls().disconnected, 3);
  assert.equal(element.paused, true);
  assert.throws(() => route.setMode('unknown'), /Unknown audio output mode/);
});

test('media element rejection is propagated instead of silently claiming background output', async () => {
  const { route, element } = makeRoute();
  element.play = async () => { throw new Error('NotAllowedError'); };
  route.setMode('media');
  await assert.rejects(route.play(), /NotAllowedError/);
});
