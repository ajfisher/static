/* Produce successive PCM blocks with smoothed audio transitions.
 * Each offline render includes extra tail audio, used to bridge the next render.
 * Duration and overlap must align to 20-ms Opus frame boundaries.
 */
export function spliceRenderedAudio(buffer, previousTail, {
  outputFrames,
  overlapFrames
}) {
  if (buffer.numberOfChannels !== 2 || buffer.length < outputFrames + overlapFrames
      || overlapFrames < 2 || overlapFrames >= outputFrames) {
    throw new Error('Invalid PCM seam input');
  }
  if (previousTail && (previousTail.length !== 2 || previousTail.some(x => x.length !== overlapFrames))) {
    throw new Error('Incompatible previous PCM tail');
  }
  const channels = [], tail = [];
  for (let c = 0; c < 2; c++) {
    const source = buffer.getChannelData(c);
    const output = new Float32Array(outputFrames);
    output.set(source.subarray(0, outputFrames));
    if (previousTail) {
      for (let i = 0; i < overlapFrames; i++) {
        const t = i / (overlapFrames - 1);
        // Raised-cosine crossfade blends two independent random signal phases.
        const weight = (1 - Math.cos(Math.PI * t)) * .5;
        output[i] = previousTail[c][i] * (1 - weight) + output[i] * weight;
      }
    }
    channels.push(output);
    tail.push(source.slice(outputFrames, outputFrames + overlapFrames));
  }
  return {channels, tail};
}