import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, arrange, planRegions, validateSession, validateCoverage, videoIdentities, DEFAULT_AUTO_CLIPS } from '../../packages/composer-core/index.mjs';
import { draftAssemblyProposal } from '../../packages/composer-core/draft-proposal.mjs';

const song=duration_ms=>({id:'song',name:'Pacing',duration_ms});
const clip=(id,duration_ms=30000,quality=5)=>({id,name:id,path:`/clips/${id}.mp4`,duration_ms,quality,available:true,script_ready:true,categories:['A']});
const recipe=(duration,sections=1)=>({...createSession(song(duration),sections),auto_clip:{...DEFAULT_AUTO_CLIPS}});
function verify(s,clips){
  validateSession(s,clips);validateCoverage(s);
  const identity=videoIdentities(clips);
  if(s.repeat_policy!=='cycle')assert.equal(new Set(s.placements.map(p=>identity.get(p.clip_id))).size,s.placements.length);
  for(const section of s.sections){
    if(section.locked||section.planned_regions)continue;
    const rows=s.placements.filter(p=>p.section_id===section.id);
    assert.ok(new Set(rows.map(p=>identity.get(p.clip_id))).size>=2,'each automatic section uses different sources');
    for(const p of rows)assert.ok(p.end_ms-p.start_ms>=4000&&p.end_ms-p.start_ms<=12000,`${p.end_ms-p.start_ms}ms is outside pacing limits`);
  }
}

test('automatic sections use 4–12 second clips, rebalance leftovers and never fill a section with one source',()=>{
  const clips=Array.from({length:30},(_,i)=>clip(String(i),i%3?4700:60000));
  for(const duration of [8000,8100,12500,13000,16000,24100,34000,61000])for(let seed=1;seed<=8;seed++){
    const s=recipe(duration);s.seed=seed;
    const result=arrange(s,clips);verify(result,clips);assert.deepEqual(result,arrange(s,clips));
  }
  const multi=arrange(recipe(102000,3),clips);verify(multi,clips);
});

test('short sources are excluded and high notes stay preferred after remainder redistribution',()=>{
  const s=recipe(13000),clips=[clip('best',7000,5),clip('second',4000,4),clip('third',4000,3),clip('flash',900,5)];
  const result=arrange(s,clips);verify(result,clips);
  assert.deepEqual(result.placements.map(p=>[p.clip_id,p.end_ms-p.start_ms]),[['best',5000],['second',4000],['third',4000]]);
});

test('one available source and undersized sections fail without editing the original recipe or repeating footage',()=>{
  const s=recipe(20000),before=structuredClone(s);
  assert.throws(()=>arrange(s,[clip('only',60000)]),/without repeating/);assert.deepEqual(s,before);
  assert.throws(()=>arrange({...s,repeat_policy:'cycle'},[clip('only',60000)]),/two different/);
  assert.throws(()=>arrange(recipe(7900),[clip('a'),clip('b')]),e=>e.code==='CLIP_PACING'&&e.message.includes('Extend or merge'));
  assert.throws(()=>arrange(s,[clip('a',900),clip('b',800)]),/No usable clips/);
});

test('manual cuts and kept sections retain their explicit spans; cycle mode still uses multiple sources',()=>{
  const clips=[clip('a'),clip('b')];
  let s=recipe(13000);s=planRegions(s,s.sections[0].id,[500]);
  const manual=arrange(s,clips);assert.deepEqual(manual.placements.map(p=>p.end_ms-p.start_ms),[500,12500]);
  manual.sections[0].locked=true;assert.deepEqual(arrange(manual,clips).placements,manual.placements);
  const cycle={...recipe(40000),repeat_policy:'cycle'},short=[clip('a',6000),clip('b',6000)];
  verify(arrange(cycle,short),short);
});

test('draft proposals obey automatic pacing and cannot count a second variant as a second source',()=>{
  const s=recipe(20000),a=clip('approved',20000),draft={...clip('draft',20000),origin:'dataset',review_status:'draft'};
  const proposal=draftAssemblyProposal(s,[a,draft]);assert.ok(proposal);verify(proposal.assembled,[a,draft]);
  assert.equal(draftAssemblyProposal(s,[{...a,civitai_id:'1'},{...draft,civitai_id:'1'}]),null);
  for(const auto_clip of [null,{}, {min_ms:0,max_ms:12000},{min_ms:5000,max_ms:4000},{min_ms:4000,max_ms:Infinity}])assert.throws(()=>validateSession({...s,auto_clip}),/Automatic clip lengths/);
});

test('paced unique search agrees with independent source-subset feasibility for overlapping sections',()=>{
  let state=51;const random=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};
  function possible(s,clips,i=0,used=0){
    if(i===s.sections.length)return true;
    const section=s.sections[i],duration=section.end_ms-section.start_ms;
    for(let mask=1;mask<1<<clips.length;mask++){
      if(mask&used)continue;
      const rows=clips.filter((_,j)=>mask&(1<<j));
      if(rows.length<2||rows.length*4000>duration||rows.some(c=>!c.categories.includes(section.category))||rows.reduce((n,c)=>n+Math.min(12000,c.duration_ms),0)<duration)continue;
      if(possible(s,clips,i+1,used|mask))return true;
    }
    return false;
  }
  for(let trial=0;trial<100;trial++){
    const a=8000+random(9000),b=8000+random(9000),s=recipe(a+b,2);s.seed=trial+1;
    s.sections[0].end_ms=a;s.sections[1].start_ms=a;s.sections[0].category='A';s.sections[1].category='B';
    const clips=Array.from({length:7},(_,i)=>({...clip(String(i),4000+random(10000),random(6)),categories:random(3)?['A','B']:['AB'[random(2)]]}));
    if(possible(s,clips))verify(arrange(s,clips),clips);else assert.throws(()=>arrange(s,clips),/without repeating/);
  }
});
