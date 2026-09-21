import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, arrange, compile, validateSession, clipRating, remapActions, sourceTime, songTime, History } from '../../packages/composer-core/index.mjs';

const script={actions:[{at:0,pos:0},{at:500,pos:100},{at:1000,pos:0}]};
const clips=['a','b','c'].map(id=>({id,name:id,duration_ms:1000,available:true,categories:['A'],scripts:{L0:script,R0:script}}));
const song={id:'song',name:'test.wav',duration_ms:6000};

test('trim and retime interpolate source bounds and apply strength once',()=>{
  const p={start_ms:2000,end_ms:2500,source_in_ms:250,rate:1};
  assert.deepEqual(remapActions(script.actions,p,50),[{at:2000,pos:50},{at:2250,pos:75},{at:2500,pos:50}]);
  p.rate=2;p.end_ms=2250;
  assert.deepEqual(remapActions(script.actions,p),[{at:2000,pos:50},{at:2125,pos:100},{at:2250,pos:50}]);
  assert.equal(songTime(p,sourceTime(p,2099.123)),2099.123);
});
test('arrangement is deterministic, covers each section, honors locks and categories',()=>{
  const initial=createSession(song,3);initial.sections.forEach(s=>s.category='A');
  const first=arrange(initial,clips);assert.deepEqual(first,arrange(initial,clips));
  for(let i=1;i<first.placements.length;i++)assert.notEqual(first.placements[i].clip_id,first.placements[i-1].clip_id);
  first.sections[1].locked=true;first.seed++;
  const variant=arrange(first,clips);
  assert.deepEqual(variant.placements.filter(p=>p.section_id===first.sections[1].id),first.placements.filter(p=>p.section_id===first.sections[1].id));
  assert.equal(compile(variant,clips).duration_ms,6000);
  initial.sections[0].category='missing';assert.throws(()=>arrange(initial,clips),/No usable clips/);
});
test('renderer catalog summaries can arrange script-ready assets',()=>{
  const visible=clips.map(({scripts,...c})=>({...c,script_ready:true}));
  assert.equal(arrange(createSession(song,1),visible).placements.length,6);
});
test('compilation emits six bounded ordered axes and millisecond chapters',()=>{
  const s=arrange(createSession(song,3),clips),output=compile(s,clips);
  assert.equal(Object.keys(output.scripts).length,6);
  assert.equal(output.scripts.L0.metadata.chapters[1].startTime,2000);
  for(const data of Object.values(output.scripts)){
    assert.equal(data.actions[0].at,0);assert.equal(data.actions.at(-1).at,6000);
    data.actions.forEach((a,i)=>{assert.ok(a.pos>=0&&a.pos<=100);if(i)assert.ok(a.at>data.actions[i-1].at);});
  }
  assert.ok(output.scripts.L1.actions.every(a=>a.pos===50));
});
test('song motion replaces only explicitly marked gaps; holds stay neutral',()=>{
  const s=arrange(createSession(song,1),clips);
  s.analysis={duration_ms:6000,bpm:120,confidence:.8,waveform:Array(60).fill(1),beats:[],onsets:[]};
  s.sections[0].motion='gaps';s.sections[0].gaps=[[2100,2800]];
  const output=compile(s,clips);assert.ok(output.blocks.some(b=>b.kind==='song'&&b.start_ms===2100));
  const original=compile({...s,sections:[{...s.sections[0],motion:'clip'}]},clips);
  assert.deepEqual(output.scripts.L0.actions.filter(a=>a.at<2000),original.scripts.L0.actions.filter(a=>a.at<2000));
  s.sections[0].motion='hold';assert.ok(compile(s,clips).scripts.L0.actions.every(a=>a.pos===50));
});
test('invalid ranges, gaps, rate, uncovered timeline and stale clip IDs are rejected',()=>{
  const s=arrange(createSession(song,2),clips);
  s.placements[0].rate=4;assert.throws(()=>compile(s,clips),/exceeds/);
  s.placements[0].rate=1;s.placements.pop();assert.throws(()=>compile(s,clips),/does not cover/);
  s.sections[0].end_ms--;assert.throws(()=>validateSession(s),/without gaps/);
});
test('undo and redo isolate past snapshots',()=>{
  const history=new History(),s=createSession(song);history.record(s);s.sections[0].label='changed';
  const old=history.undo(s);assert.equal(old.sections[0].label,'Section 1');assert.equal(history.redo(old).sections[0].label,'changed');
});

test('minimum ratings select 4★+ or 5★ only and exclude unrated variants',()=>{
  const rated=clips.map((c,i)=>({...c,quality:[4,5,0][i]}));
  const s=createSession(song,1);s.min_rating=4;
  const four=arrange(s,rated);assert.deepEqual(new Set(four.placements.map(p=>p.clip_id)),new Set(['a','b']));
  s.min_rating=5;assert.ok(arrange(s,rated).placements.every(p=>p.clip_id==='b'));
  assert.throws(()=>arrange(s,rated.filter(c=>c.id!=='b')),/5★ or higher/);
  assert.throws(()=>arrange(s,clips),/5★ or higher/);
  delete s.min_rating;assert.doesNotThrow(()=>compile(arrange(s,clips),clips),'legacy sessions still accept unrated clips');
});

test('rating overrides preserve explicit unrated and malformed ratings are not stars',()=>{
  assert.equal(clipRating({quality:5}),5);
  assert.equal(clipRating({quality:5,user_rating:0}),0);
  assert.equal(clipRating({quality:2,user_rating:4}),4);
  for(const quality of [undefined,null,'5',4.5,-1,6,NaN])assert.equal(clipRating({quality}),0);
  const s=createSession(song,1);s.min_rating=5;
  assert.throws(()=>arrange(s,clips.map(c=>({...c,quality:5,user_rating:0}))),/No usable clips/);
  for(const min_rating of [null,'4',4.5,-1,6,NaN])assert.throws(()=>validateSession({...s,min_rating}),/Minimum rating/);
});

test('locked clips and existing placements cannot bypass the minimum at compilation',()=>{
  const rated=clips.map((c,i)=>({...c,quality:[4,5,0][i]}));
  const s=arrange({...createSession(song,1),min_rating:4},rated);s.sections[0].locked=true;s.min_rating=5;
  assert.doesNotThrow(()=>validateSession(s),'a session can be edited while placements need fixing');
  assert.throws(()=>arrange(s,rated),/Unlock affected sections/);
  assert.throws(()=>compile(s,rated),/below the 5★ minimum/);
  s.sections[0].locked=false;const fixed=arrange(s,rated);assert.doesNotThrow(()=>compile(fixed,rated));
  fixed.placements[0].clip_id='a';assert.throws(()=>compile(fixed,rated),/below the 5★ minimum/);
  fixed.sections[0].motion='hold';assert.throws(()=>compile(fixed,rated),/below the 5★ minimum/,'all motion policies honor rating');
});
