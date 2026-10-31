import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { OpusStreamEncoder, OPUS_FRAME_SAMPLES } from '../opus-encoder.js';

// Simulate an encoder with one packet of lookahead. Calling flush() would
// release a padded packet and reset the codec, which is precisely what must
// not happen at a 30-second render boundary.
class DelayedPacketEncoder {
  static instances = [];
  constructor({ output }) {
    this.output = output;
    this.state = 'unconfigured';
    this.encodeQueueSize = 0;
    this.listeners = [];
    this.pending = null;
    this.flushCount = 0;
    this.peakQueueSize = 0;
    DelayedPacketEncoder.instances.push(this);
  }
  configure() { this.state = 'configured'; }
  addEventListener(type, fn) {
    if (type === 'dequeue') this.listeners.push(fn);
  }
  emit(timestamp) {
    const data = Uint8Array.of(0xf8, 0x02, 0x00);
    this.output({
      timestamp, duration: 20_000, byteLength: data.byteLength,
      copyTo: target => target.set(data)
    });
  }
  encode(frame) {
    this.encodeQueueSize++;
    this.peakQueueSize = Math.max(this.peakQueueSize, this.encodeQueueSize);
    const timestamp = frame.timestamp;
    queueMicrotask(() => {
      this.encodeQueueSize--;
      if (this.pending !== null) this.emit(this.pending);
      this.pending = timestamp;
      for (const listener of this.listeners) listener();
    });
  }
  async flush() {
    this.flushCount++;
    if (this.pending !== null) this.emit(this.pending);
    this.pending = null;
  }
  close() { this.state = 'closed'; }
}
class FakeAudioData {
  constructor({ timestamp }) { this.timestamp = timestamp; }
  close() {}
}

test('Opus encoder retains a continuous timestamp sequence without per-block flush', async () => {
  const encoder = new OpusStreamEncoder({
    AudioEncoderClass: DelayedPacketEncoder,
    AudioDataClass: FakeAudioData
  });
  const pcm = [new Float32Array(OPUS_FRAME_SAMPLES * 40), new Float32Array(OPUS_FRAME_SAMPLES * 40)];
  try {
    const first = await encoder.encodeBuffer(pcm, { maxQueueSize: 5 });
    const second = await encoder.encodeBuffer(pcm, { maxQueueSize: 5 });
    const codec = DelayedPacketEncoder.instances.at(-1);
    assert.equal(codec.flushCount, 0, 'a 30-second boundary cannot drain/pad the codec');
    assert.equal(codec.peakQueueSize <= 5, true, 'backpressure must bound queued work');
    assert.equal(first.length, 39, 'last lookahead packet remains pending');
    assert.equal(second.length, 40, 'delayed packet is returned in the next render batch');
    const timestamps = [...first, ...second].map(packet => packet.timestamp);
    for (let i = 0; i < timestamps.length; i++) {
      assert.equal(timestamps[i], i * 20000, 'packets cannot overlap or skip a timestamp');
    }
    assert.equal(encoder.sampleCursor, OPUS_FRAME_SAMPLES * 80);
    assert.equal(encoder.packets.length, 0, 'emitted packet queue must be consumed');
  } finally { encoder.close(); }
});

test('Opus encoder does not accept malformed PCM or an invalid queue bound', async () => {
  const encoder = new OpusStreamEncoder({
    AudioEncoderClass: DelayedPacketEncoder,
    AudioDataClass: FakeAudioData
  });
  try {
    await assert.rejects(
      encoder.encodeBuffer([new Float32Array(1200), new Float32Array(960)]),
      /equally-sized/
    );
    await assert.rejects(
      encoder.encodeBuffer([new Float32Array(1200), new Float32Array(1200)]),
      /align/
    );
    await assert.rejects(
      encoder.encodeBuffer([new Float32Array(960), new Float32Array(960)], { maxQueueSize: 0 }),
      /queue size/
    );
  } finally { encoder.close(); }
});
