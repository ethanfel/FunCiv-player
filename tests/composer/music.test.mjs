import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSession, compile, validateSession, History } from '../../packages/composer-core/index.mjs';
import { createMusic, generateMusicBlock, replaceMusicRange, musicMotion } from '../../packages/composer-core/music.mjs';
import { generateBeatSection } from '../../vendor/motion-studio/audio-patterns.mjs';
import { evaluate } from '../../vendor/motion-studio/curve.mjs';
import { ComposerService } from '../../electron/composer-service.cjs';

const analysis=(times=[200,700,1300,1800,2350,2900,3400,3900])=>({version:4,duration_ms:4000,bpm:120,confidence:1,waveform:Array(160).fill(.8),
  beats:times.map(at=>({at,strength:1})),onsets:times.map(at=>({at,strength:1,peak_at:at+5})),attacks:times.map(at=>({at,strength:1,peak_at:at+5,bands:[1,.1,.05]}))});
function fixture(){
  const s=createSession({id:'song',name:'Full mix.wav',duration_ms:4000},1);s.blend_ms=0;s.analysis=analysis();
  s.music=createMusic();s.music.beat_track={id:'beat',name:'Drums.wav',duration_ms:4000};s.music.analysis=analysis();
  s.music.settings={...s.music.settings,mode:'manual',shape:'Triangle',rhythm:'original',followEnergy:false};
  return s;
}
test('drum peaks, independent alignment, shape choices and repeatable variations use the beat source',()=>{
  const s=fixture();s.analysis=analysis([100,1000,2000,3000]);
  const first=generateMusicBlock(s,0,4000);assert.deepEqual(first.events.map(e=>e.at),[205,705,1305,1805,2355,2905,3405,3905]);
  for(const event of first.events)assert.ok(evaluate(first.actions,event.at)<=11,'downstroke lands on each measured peak');
  s.music.offset_ms=100;const shifted=generateMusicBlock(s,0,4000);
  assert.deepEqual(shifted.events.map(e=>e.at),first.events.map(e=>e.at+100).filter(at=>at<4000));
  assert.deepEqual(s.analysis,analysis([100,1000,2000,3000]),'main song clock and analysis stay unchanged');
  const shaped=generateMusicBlock(s,0,4000,{...s.music.settings,shape:'Hold High'});assert.notDeepEqual(shaped.actions,shifted.actions);
  const settings={...s.music.settings,mode:'random',seed:21};assert.deepEqual(generateMusicBlock(s,0,4000,settings),generateMusicBlock(s,0,4000,settings));
});
test('saved ranges replace intersections, preserve surrounding audio and undo in one step',()=>{
  const s=fixture(),history=new History(),whole=generateMusicBlock(s,0,4000);s.music=replaceMusicRange(s,0,4000,whole);history.record(s);
  const replacement=generateMusicBlock(s,1000,2500,{...s.music.settings,shape:'Double Tap'}),next=structuredClone(s);
  next.music=replaceMusicRange(next,1000,2500,replacement);validateSession(next);
  assert.deepEqual(next.music.blocks.map(b=>[b.start,b.end]),[[0,1000],[1000,2500],[2500,4000]]);
  for(const at of [100,750,2700,3500])assert.equal(evaluate(musicMotion(next,0,4000),at),evaluate(musicMotion(s,0,4000),at));
  assert.deepEqual(history.undo(next),s);
});
test('authored music drives only audio-sync/song ranges, keeps source trims and scales with section strength',()=>{
  const s=fixture();s.music=replaceMusicRange(s,0,4000,generateMusicBlock(s,0,4000));
  const motion={id:'video',name:'Motion',duration_ms:10000,scripts:{L0:{actions:[{at:0,pos:20},{at:10000,pos:20}]},R0:{actions:[{at:0,pos:80},{at:10000,pos:80}]}}};
  const sync={id:'sync',name:'Audio sync',duration_ms:10000,audio_sync:true};
  s.placements=[[0,1000,motion],[1000,3000,sync],[3000,4000,motion]].map(([start_ms,end_ms,clip],i)=>({id:`p${i}`,section_id:s.sections[0].id,clip_id:clip.id,start_ms,end_ms,source_in_ms:500,rate:1}));
  const out=compile(s,[motion,sync]);
  for(const at of [500,3500])assert.equal(evaluate(out.scripts.L0.actions,at),20);
  for(const at of [1100,1400,2000,2700])assert.equal(evaluate(out.scripts.L0.actions,at),evaluate(s.music.blocks[0].actions,at));
  assert.equal(evaluate(out.scripts.R0.actions,2000),50);assert.equal(evaluate(out.scripts.R0.actions,500),80);
  s.placements[1].source_in_ms=2300;s.placements[1].rate=.5;assert.deepEqual(compile(s,[motion,sync]).scripts,out.scripts);
  s.sections[0].strength=40;for(const p of compile(s,[motion,sync]).scripts.L0.actions.filter(p=>p.at>1000&&p.at<3000))assert.ok(p.pos>=30&&p.pos<=70);
  s.analysis=null;s.music.analysis=null;assert.doesNotThrow(()=>compile(s,[motion,sync]),'complete authored coverage can compile offline from saved points');
});
test('automatic uncovered ranges use drum settings, with neutral output beyond stem coverage',()=>{
  const s=fixture();s.music.offset_ms=500;const curve=musicMotion(s,0,4000);assert.equal(evaluate(curve,100),50);
  const replacement=generateMusicBlock(s,1000,2000,{...s.music.settings,shape:'Sine Wave'});s.music=replaceMusicRange(s,1000,2000,replacement);
  const out=musicMotion(s,0,4000);assert.equal(evaluate(out,1500),evaluate(replacement.actions,1500));assert.ok(out.some(p=>p.at>2500&&p.pos!==50));
});
test('legacy sessions retain exactly the old audio-sync generator until music editing is used',()=>{
  const s=fixture();delete s.music;s.bpm=137;
  for(const strength of [15,40,100])assert.deepEqual(musicMotion(s,100,3500,strength),generateBeatSection({analysis:s.analysis,offset_ms:0},100,3500,{mode:'manual',shape:'Sine Wave',timing:'tempo',bpm:137,amplitude:strength/2,center:50,followEnergy:true,seed:s.seed}).actions);
});
test('malformed music settings, overlapping blocks and bad point/time data cannot be saved',()=>{
  const s=fixture();s.music=replaceMusicRange(s,0,4000,generateMusicBlock(s,0,4000));
  for(const mutate of [s=>s.music.offset_ms=NaN,s=>s.music.settings.maxHitsPerSecond=0,s=>s.music.blocks.push({...s.music.blocks[0],id:'other'}),
    s=>s.music.blocks[0].actions[1].pos=101,s=>s.music.blocks[0].actions[1].at=0,s=>s.music.analysis.onsets[0].at=-1]){
    const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateSession(bad));
  }
});
test('beat imports have their own catalog, persist with the session and never replace export audio',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-music-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const service=await new ComposerService(path.join(root,'data')).init(),signal=new AbortController().signal;
  for(const [name,hz] of [['mix',220],['drums',90]])await service.run('ffmpeg',['-v','error','-f','lavfi','-i',`sine=frequency=${hz}:duration=4`,path.join(root,name+'.wav')],signal);
  const song=await service.importSong(path.join(root,'mix.wav'),signal),drums=await service.importBeatTrack(path.join(root,'drums.wav'),signal);
  assert.equal(service.catalog.songs.length,1);assert.equal(service.catalog.beats.length,1);assert.notEqual(song.id,drums.id);
  const library=path.join(root,'clips');await fs.mkdir(library);
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=teal:s=160x90:r=30:d=4','-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',path.join(library,'clip.mp4')],signal);
  await service.scan(library,signal);service.catalog.clips[0].audio_sync=true;await service.saveCatalog();
  const s=fixture();s.song=song;s.output={preset:'landscape-720',fit:'cover'};s.music.beat_track=drums;
  s.music=replaceMusicRange(s,0,4000,generateMusicBlock(s,0,4000));
  s.placements=[{id:'p0',section_id:s.sections[0].id,clip_id:service.catalog.clips[0].id,start_ms:0,end_ms:4000,source_in_ms:0,rate:1}];
  const saved=await service.saveSession(s),reopened=await service.loadSession(saved.id);assert.deepEqual(reopened.music,s.music);
  const prepared=await service.prepare(reopened);assert.equal(prepared.snapshot.song.id,song.id);
  assert.equal(service.usage.sequence,0,'ordinary preparation does not count as use');
  await assert.rejects(service.render(reopened,AbortSignal.abort()),/abort/i);assert.equal(service.usage.sequence,0,'failed export does not count');
  const result=await service.render(reopened,signal);assert.deepEqual(await service.renderScripts(result.id),prepared.snapshot.scripts);
  assert.equal(service.usage.sequence,1);assert.equal(service.state().clips[0].usage.weight,20);
  await Promise.all([service.recordUse(prepared.usage_token),service.recordUse(prepared.usage_token)]);
  assert.equal(service.usage.sequence,1,'export and device-ready preparation of the same cut list count once');
  const edited=structuredClone(reopened);edited.name='Renamed';edited.revision++;
  const renamed=await service.prepare(edited);await service.recordUse(renamed.usage_token);assert.equal(service.usage.sequence,1);
  edited.id='next-composition';const second=await service.prepare(edited);await service.recordUse(second.usage_token);assert.equal(service.usage.sequence,2);
  await assert.rejects(async()=>service.recordUse('unknown'),/Prepare/);
  const restarted=await new ComposerService(path.join(root,'data')).init();assert.deepEqual(restarted.state().beats,[drums]);assert.equal(restarted.usage.sequence,2);assert.equal(restarted.state().clips[0].usage.count,2);
});

test('multi-band attacks validate by refined peak time when coarse detection frames cross',()=>{
  const s=fixture();s.music.analysis.attacks=[
    {at:1600,peak_at:1580,strength:.8,bands:[.8,0,0]},
    {at:1575,peak_at:1615,strength:.5,bands:[0,.5,0]}
  ];
  assert.doesNotThrow(()=>validateSession(s));
  assert.doesNotThrow(()=>generateMusicBlock(s,0,4000));
  s.music.analysis.attacks.reverse();assert.throws(()=>validateSession(s),/timing/);
});
