import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PrimeMotion } from '../prime-motion-core.js';
import { LAYERS } from '../config.js';

const cadence = id => LAYERS.find(x => x.id === id).motion;

test('irregular environmental layers use different, prime-length cadences', () => {
  const expected = {
    waves: [11, 17, 29],
    rainBody: [7, 13, 31],
    rain: [5, 11, 23]
  };
  for (const [id, periods] of Object.entries(expected)) {
    assert.deepEqual(cadence(id).periods, periods);
    assert.equal(cadence(id).type, 'prime');
    assert.ok(cadence(id).base > 0);
  }
});

test('wave envelopes are finite, continuous, bounded and irregular over time', () => {
  const model = new PrimeMotion({periods:cadence('waves').periods,style:'waves',seed:703});
  const strengths = [];
  let maxStep = 0;
  let previous = model.read();
  for (let i = 0; i < 12000; i++) {
    const value = model.advance(.05);
    assert.ok(Number.isFinite(value.strength) && Number.isFinite(value.colour));
    assert.ok(value.strength >= 0 && value.strength <= 1);
    assert.ok(value.colour >= -1 && value.colour <= 1);
    maxStep = Math.max(maxStep,Math.abs(value.strength-previous.strength));
    if (i % 20 === 0) strengths.push(value.strength);
    previous = value;
  }
  // Smooth gain control, without sudden 50ms jumps.
  assert.ok(maxStep < .035, `Largest gain jump was ${maxStep}`);
  assert.ok(Math.max(...strengths)-Math.min(...strengths)>.28, 'Wave swells are dynamic');
  // Consecutive 11-second intervals should not match point for point.
  const first = strengths.slice(100,111);
  const second = strengths.slice(111,122);
  assert.ok(first.some((v,i)=>Math.abs(v-second[i])>.06), 'No identical repeated swells');
});

test('rain variation remains subtler than waves and starts with different phases', () => {
  for (const id of ['rainBody','rain']) {
    const spec = cadence(id);
    const motion = new PrimeMotion({style:'rain',periods:spec.periods,seed:27});
    const values = [];
    for (let i=0;i<2400;i++) values.push(motion.advance(.05).strength);
    assert.ok(Math.min(...values)>=0);
    assert.ok(Math.max(...values)<=1);
    assert.ok(Math.min(...values)*spec.depth+spec.base>0.7, 'No extreme rain pumping');
    assert.ok(Math.max(...values)*spec.depth+spec.base<1.01);
  }
});

test('seeded motion is deterministic for tests, but distinct between runs', () => {
  const opts = {style:'waves',periods:[11,17,29],seed:412};
  const one = new PrimeMotion(opts);
  const two = new PrimeMotion(opts);
  const other = new PrimeMotion({...opts,seed:413});
  let differing = 0;
  for (let i=0;i<300;i++) {
    const a=one.advance(.08);
    const b=two.advance(.08);
    const c=other.advance(.08);
    assert.deepEqual(a,b);
    differing+=Math.abs(a.strength-c.strength);
  }
  assert.ok(differing>5, 'Independent sessions start with different cadence phases');
});

test('worklet renders interpolated, finite control samples across audio blocks', async () => {
  let Processor;
  globalThis.AudioWorkletProcessor=class {};
  globalThis.sampleRate=48000;
  globalThis.registerProcessor=(name, cls)=>{if(name==='static-prime-motion') Processor=cls;};
  try {
    await import('../prime-motion-worklet.js');
    const p=new Processor({processorOptions:{periods:[11,17,29],style:'waves',seed:123}});
    let last=null;
    let min=Infinity,max=-Infinity;
    for(let block=0;block<350;block++) {
      const a=new Float32Array(128),b=new Float32Array(128);
      p.process([],[[a],[b]]);
      for(let i=0;i<a.length;i++) {
        assert.ok(Number.isFinite(a[i]) && Number.isFinite(b[i]));
        assert.ok(a[i]>=0&&a[i]<=1);
        assert.ok(b[i]>=-1&&b[i]<=1);
        if(last!==null) assert.ok(Math.abs(a[i]-last)<.01,'No block boundary click');
        last=a[i];
        min=Math.min(min,a[i]);max=Math.max(max,a[i]);
      }
    }
    assert.ok(max>min);
  } finally {
    delete globalThis.AudioWorkletProcessor;
    delete globalThis.sampleRate;
    delete globalThis.registerProcessor;
  }
});
