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
    channels.push(output);
    tail.push(source.slice(outputFrames, outputFrames + overlapFrames));
  }

  if (previousTail) {
    for (let i = 0; i < overlapFrames; i++) {
      const t = i / (overlapFrames - 1);
      // Two independent synthetic noise renders have uncorrelated phases.
      // Equal-gain fades (including a raised-cosine weight) lose ~3 dB RMS
      // at the midpoint, heard as pumping every 30 seconds.
      // Quarter-sine / quarter-cosine gains preserve their expected power:
      //   fadeOut² + fadeIn² = 1.
      const angle = Math.PI * t * 0.5;
      const fadeOut = Math.cos(angle);
      const fadeIn = Math.sin(angle);
      for (let c = 0; c < 2; c++) {
        channels[c][i] = previousTail[c][i] * fadeOut + channels[c][i] * fadeIn;
      }
    }
  }
  return {channels, tail};
}
