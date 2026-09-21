import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, arrange, compile, isAudioSyncClip } from '../../packages/composer-core/index.mjs';
import { evaluate } from '../../vendor/motion-studio/curve.mjs';

const song={id:'song',name:'Synthetic.wav',duration_ms:4000};
const analysis={duration_ms:4000,bpm:120,confidence:1,waveform:Array(80).fill(1),beats:[],onsets:[]};
const constant=pos=>({actions:[{at:0,pos},{at:6000,pos}]});
const video={id:'video',name:'Video',duration_ms:6000,available:true,categories:['Flow'],scripts:{L0:constant(10),R0:constant(80)}};
const audio={...video,id:'audio',name:'Audio clip',audio_sync:true,scripts:{R0:constant(100)}};
function mixed(){
  const s=createSession(song,1),section=s.sections[0];s.analysis=structuredClone(analysis);s.blend_ms=0;
  s.placements=[[0,1000,'video'],[1000,3000,'audio'],[3000,4000,'video']].map(([start_ms,end_ms,clip_id],i)=>({id:`p${i}`,section_id:section.id,clip_id,start_ms,end_ms,source_in_ms:clip_id==='audio'?500:0,rate:clip_id==='audio'?2:1}));
  return s;
}

test('audio sync generates song-time strokes only within the marked video region',()=>{
  const s=mixed(),out=compile(s,[video,audio]);
  assert.deepEqual(out.blocks.map(b=>[b.start_ms,b.end_ms,b.kind,b.audio_sync===true]),[[0,1000,'clip',false],[1000,3000,'song',true],[3000,4000,'clip',false]]);
  assert.deepEqual(out.placements,s.placements,'generation preserves video cuts, speed and source trim');
  for(const at of [500,3500]){assert.equal(evaluate(out.scripts.L0.actions,at),10);assert.equal(evaluate(out.scripts.R0.actions,at),80);}
  const whole=compile({...s,sections:[{...s.sections[0],motion:'song'}]},[video,audio]);
  for(const at of [1125,1250,1500,1750,2125,2750]){
    assert.ok(Math.abs(evaluate(out.scripts.L0.actions,at)-evaluate(whole.scripts.L0.actions,at))<=1,'audio motion stays on the global song clock');
    for(const axis of ['L1','L2','R0','R1','R2'])assert.equal(evaluate(out.scripts[axis].actions,at),50,'video script axes do not leak into audio-sync regions');
  }
  assert.ok(out.scripts.L0.actions.some(a=>a.at>1000&&a.at<3000&&a.pos>60));
  s.placements[1].source_in_ms=1500;s.placements[1].rate=.5;
  assert.deepEqual(compile(s,[video,audio]).scripts,out.scripts,'slipping or retiming the video does not retime generated strokes');
  const withScript=compile(s,[video,{...audio,scripts:video.scripts}]);
  assert.deepEqual(withScript.scripts,out.scripts,'the label overrides a stored motion script too');
  s.sections[0].strength=40;
  assert.ok(compile(s,[video,audio]).scripts.L0.actions.filter(a=>a.at>1100&&a.at<2900).every(a=>a.pos>=30&&a.pos<=70),'section strength applies to generated motion');
});

test('audio sync requires analysis and respects explicit song, gaps and hold policies',()=>{
  const s=mixed();s.analysis=null;
  assert.throws(()=>compile(s,[video,audio]),/Analyze the song/);
  s.sections[0].motion='hold';
  assert.ok(Object.values(compile(s,[video,audio]).scripts).every(script=>script.actions.every(a=>a.pos===50)));
  s.analysis=analysis;s.sections[0].motion='song';
  assert.deepEqual(compile(s,[video,audio]).blocks,[{start_ms:0,end_ms:4000,kind:'song'}]);
  s.sections[0].motion='gaps';s.sections[0].gaps=[[200,600],[1700,2100]];
  const out=compile(s,[video,audio]);
  assert.ok(out.blocks.some(b=>b.audio_sync&&b.start_ms===1000&&b.end_ms===3000));
  assert.ok(out.blocks.some(b=>b.kind==='song'&&b.start_ms===200&&b.end_ms===600));
  assert.equal(evaluate(out.scripts.L0.actions,3500),10);
});

test('audio-sync selection accepts video without scripts but still honors category, rating and draft rules',()=>{
  const clip={...audio,origin:'dataset',review_status:'draft',quality:4,scripts:{}},s=createSession(song,1);s.sections[0].categories=['Flow'];s.min_rating=4;
  assert.throws(()=>arrange(s,[clip]),/No usable clips/);
  s.include_drafts=true;assert.equal(arrange(s,[clip]).placements[0].clip_id,'audio');
  s.analysis=analysis;assert.ok(compile(arrange(s,[clip]),[clip]).blocks.every(b=>b.audio_sync));
  for(const change of [{quality:3},{available:false},{categories:['Other']},{audio_sync:false},{audio_sync:'true'}])assert.throws(()=>arrange(s,[{...clip,...change}]),/No usable clips/);
  for(const audio_sync of [undefined,false,null,'true',1])assert.equal(isAudioSyncClip({audio_sync}),false);
  const kept=arrange(s,[clip]);kept.sections[0].locked=true;kept.include_drafts=false;
  assert.throws(()=>arrange(kept,[clip]),/draft scripts are disabled/);
  assert.throws(()=>compile(kept,[clip]),/draft scripts are disabled/);
});
