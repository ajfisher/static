/* Minimal WebM/Opus byte-stream muxer for Media Source Extensions.
 * A single init segment followed by timestamped Cluster media segments.
 * WebM Audio Track: A_OPUS, stereo, 48 kHz. No external dependencies.
 */
const encoder = new TextEncoder();
const id = n => {
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 255); n = Math.floor(n / 256); }
  return Uint8Array.from(bytes);
};
export function concatBytes(parts) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}
function variableSize(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid EBML element length');
  for (let width = 1; width <= 8; width++) {
    if (BigInt(n) < (1n << BigInt(7 * width)) - 1n) {
      const bytes = new Uint8Array(width);
      let value = BigInt(n) | (1n << BigInt(7 * width));
      for (let i = width - 1; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
      return bytes;
    }
  }
  throw new RangeError('EBML element is too large');
}
function unsigned(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid EBML unsigned integer');
  const bytes = [];
  do { bytes.unshift(n & 255); n = Math.floor(n / 256); } while (n);
  return Uint8Array.from(bytes);
}
function unsigned64(n) {
  let value = BigInt(n);
  if (value < 0n) throw new RangeError('Invalid EBML integer');
  const bytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
  return bytes;
}
function float64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value);
  return bytes;
}
function element(elementId, value) {
  const content = Array.isArray(value) ? concatBytes(value) : value;
  return concatBytes([id(elementId), variableSize(content.byteLength), content]);
}
function u(elementId, value) { return element(elementId, unsigned(value)); }
function text(elementId, value) { return element(elementId, encoder.encode(value)); }
function master(elementId, ...elements) { return element(elementId, elements); }

// Opus Identification Header as specified by RFC 7845, §5.1.
export function opusHead({ channels = 2, sampleRate = 48000, preSkip = 312 } = {}) {
  if (channels !== 2 || sampleRate !== 48000) throw new Error('WebM muxer requires stereo 48 kHz Opus');
  const bytes = new Uint8Array(19);
  bytes.set(encoder.encode('OpusHead'));
  bytes[8] = 1;
  bytes[9] = channels;
  const view = new DataView(bytes.buffer);
  view.setUint16(10, preSkip, true);
  view.setUint32(12, sampleRate, true);
  view.setInt16(16, 0, true);
  bytes[18] = 0;
  return bytes;
}

export function webmInitSegment({ sampleRate = 48000, channels = 2 } = {}) {
  const header = master(0x1a45dfa3,
    u(0x4286, 1), u(0x42f7, 1), u(0x42f2, 4), u(0x42f3, 8),
    text(0x4282, 'webm'), u(0x4287, 4), u(0x4285, 2));
  const info = master(0x1549a966,
    u(0x2ad7b1, 1000000), text(0x4d80, 'Static'), text(0x5741, 'Static'));
  const audio = master(0xe1, element(0xb5, float64(sampleRate)), u(0x9f, channels));
  const entry = master(0xae,
    u(0xd7, 1), u(0x73c5, 1), u(0x83, 2), text(0x86, 'A_OPUS'),
    element(0x63a2, opusHead({channels, sampleRate})),
    element(0x56aa, unsigned64(6500000)),
    element(0x56bb, unsigned64(80000000)),
    audio);
  const tracks = master(0x1654ae6b, entry);
  // A Segment with unknown length is required for appending Clusters indefinitely.
  const unknownSegmentSize = new Uint8Array([0x01,0xff,0xff,0xff,0xff,0xff,0xff,0xff]);
  return concatBytes([header, id(0x18538067), unknownSegmentSize, info, tracks]);
}

export function webmCluster(packets, { originUs = 0 } = {}) {
  if (!packets.length) throw new Error('Cannot mux empty WebM cluster');
  const start = Math.round((packets[0].timestamp - originUs) / 1000);
  if (start < 0) throw new RangeError('Cluster timestamp is negative');
  const blocks = [u(0xe7, start)];
  let previous = -Infinity;
  for (const packet of packets) {
    const absolute = Math.round((packet.timestamp - originUs) / 1000);
    const relative = absolute - start;
    if (relative < 0 || relative >= 32768 || absolute < previous) {
      throw new RangeError('Cluster timestamps must increase within 32 seconds');
    }
    previous = absolute;
    const bytes = packet.data instanceof Uint8Array ? packet.data : new Uint8Array(packet.data);
    const block = new Uint8Array(4 + bytes.byteLength);
    block[0] = 0x81; // track number 1 as EBML variable-sized integer
    new DataView(block.buffer).setInt16(1, relative, false);
    block[3] = 0x80; // audio packets are independently decodable keyframes
    block.set(bytes, 4);
    blocks.push(element(0xa3, block));
  }
  return master(0x1f43b675, ...blocks);
}

export function packetClusters(packets, { maxMilliseconds = 5000, originUs = 0 } = {}) {
  const sorted = [...packets].sort((a,b) => a.timestamp - b.timestamp);
  const groups = [];
  let group = [];
  for (const packet of sorted) {
    if (group.length && (packet.timestamp - group[0].timestamp) >= maxMilliseconds * 1000) {
      groups.push(webmCluster(group, { originUs }));
      group = [];
    }
    group.push(packet);
  }
  if (group.length) groups.push(webmCluster(group, { originUs }));
  return groups;
}