import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { webmInitSegment, packetClusters, webmCluster, opusHead } from '../webm-opus.js';
import { spliceRenderedAudio } from '../pcm-seam.js';
import { OpusMsePlayer } from '../opus-stream.js';

const readId = (bytes, needle) => bytes.some((value, i)=>value===needle[0] && needle.every((byte,k)=>bytes[i+k]===byte));

test('initialisation has WebM EBML/Segment/Info/Tracks and stereo Opus metadata', () => {
  const bytes=webmInitSegment();
  assert.deepEqual([...bytes.slice(0,4)],[0x1a,0x45,0xdf,0xa3]);
  assert.ok(readId(bytes,[0x18,0x53,0x80,0x67]));
  assert.ok(readId(bytes,[0x15,0x49,0xa9,0x66]));
  assert.ok(readId(bytes,[0x16,0x54,0xae,0x6b]));
  assert.ok(readId(bytes,[0x4f,0x70,0x75,0x73,0x48,0x65,0x61,0x64]));
  const head=opusHead();
  assert.equal(new DataView(head.buffer).getUint16(10,true),312);
  assert.equal(new DataView(head.buffer).getUint32(12,true),48000);
});

test('packet clusters preserve ordered audio timeline and split regularly', () => {
  const packets = Array.from({length:500},(_,i)=>({timestamp:i*20000,data:Uint8Array.from([0xb8,i%255])}));
  const clusters=packetClusters(packets,{maxMilliseconds:2000});
  assert.equal(clusters.length,5);
  assert.ok(clusters.every(c=>c[0]===0x1f && c[1]===0x43 && c[2]===0xb6 && c[3]===0x75));
  assert.throws(()=>webmCluster([packets[0],{timestamp:40000000,data:Uint8Array.from([1])}]),/within 32 seconds/);
});

test('PCM joins exactly to previous tail at start and new segment after overlap', () => {
  const frames=8,overlap=4,old=[new Float32Array([.7,.6,.5,.4]),new Float32Array([-.7,-.6,-.5,-.4])];
  const data=[Float32Array.from({length:12},(_,i)=>.1+i*.01),Float32Array.from({length:12},(_,i)=>-.1-i*.01)];
  const input={length:12,numberOfChannels:2,getChannelData:i=>data[i]};
  const result=spliceRenderedAudio(input,old,{outputFrames:frames,overlapFrames:overlap});
  assert.ok(Math.abs(result.channels[0][0]-.7)<1e-6);
  assert.ok(Math.abs(result.channels[1][0]+.7)<1e-6);
  assert.ok(Math.abs(result.channels[0][3]-data[0][3])<1e-6);
  assert.deepEqual([...result.tail[0]],[...data[0].slice(8,12)]);
});

test('Opus MSE player appends multiple clusters to one timeline without swapping source', async () => {
  const originalURL=globalThis.URL.createObjectURL,originalRevoke=globalThis.URL.revokeObjectURL;
  globalThis.URL.createObjectURL=()=> 'blob:mock-stream';
  globalThis.URL.revokeObjectURL=()=> {};
  const mediaSource={readyState:'open',endedCount:0,reopenCount:0,addSourceBuffer(){return buffer},addEventListener(){},endOfStream(){this.endedCount++;this.readyState='ended';}};
  const buffer={mode:'segments',data:[],listeners:{},addEventListener(n,cb){this.listeners[n]=cb},removeEventListener(n){delete this.listeners[n]},appendBuffer(bytes){if(mediaSource.readyState==='ended'){mediaSource.reopenCount++;mediaSource.readyState='open'}this.data.push(bytes);queueMicrotask(()=>this.listeners.updateend?.())}};
  const audio={paused:true, buffered:{length:0},setAttribute(){}, async play(){this.paused=false},pause(){this.paused=true},load(){},removeAttribute(){},remove(){}};
  let packets=0;
  const encoderFactory=()=>({
    async encodeBuffer(){return Array.from({length:3},()=>({timestamp:packets++*20000,data:Uint8Array.from([1,2,3])}))},
    close(){}
  });
  const raw={length:32*48000,numberOfChannels:2,getChannelData:()=>new Float32Array(32*48000)};
  const oldSupported=OpusMsePlayer.supported;
  OpusMsePlayer.supported=async()=>true;
  const sound={mix:{pink:70},eq:{pink:[0,0,0,0,0]},storm:{distance:72,activity:45}};
  let appends=[];
  try {
    const player=new OpusMsePlayer({render:async()=>raw,mediaSourceFactory:()=>mediaSource,createElement:()=>audio,encoderFactory,onProgress:s=>appends.push(s.seconds)});
    await player.prepare(sound,1);
    assert.equal(player.seconds,60);
    assert.deepEqual(appends,[30,60]);
    assert.equal(mediaSource.readyState,'ended','prepared timeline must have finite end');
    assert.equal(mediaSource.endedCount,1);
    assert.ok(buffer.data.length>=3);
    assert.equal(audio.src,'blob:mock-stream');
    assert.equal(player.isReady(sound),true);
    await player.play(sound);assert.equal(audio.paused,false);
    await player.prepare(sound,1); // Extend the same source after endOfStream().
    assert.equal(player.seconds,120);
    assert.equal(mediaSource.endedCount,2);
    assert.equal(mediaSource.reopenCount,1);
    assert.equal(audio.src,'blob:mock-stream');
    assert.equal(player.isReady({...sound,mix:{pink:71}}),false);
    player.dispose();
  } finally {OpusMsePlayer.supported=oldSupported;globalThis.URL.createObjectURL=originalURL;globalThis.URL.revokeObjectURL=originalRevoke}
});