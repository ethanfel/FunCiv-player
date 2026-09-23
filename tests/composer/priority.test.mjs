import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, arrange, planRegions, clipRating, clipIntensity, videoIdentities } from '../../packages/composer-core/index.mjs';

const song=duration_ms=>({id:'song',name:'Priority fixture',duration_ms});
const clip=(id,quality,duration_ms=1000)=>({id,name:id,quality,duration_ms,categories:['A'],available:true,script_ready:true});
const ratings=(s,clips)=>s.placements.map(p=>clipRating(clips.find(c=>c.id===p.clip_id)));

test('highest notes fill the song without repeats and tied notes retain seeded variation',()=>{
  const clips=[clip('5a',5),clip('5b',5),clip('5c',5),clip('4',4),clip('3',3),clip('0',0)];
  const variations=new Set();
  for(const fixed of [false,true])for(let seed=1;seed<=12;seed++){
    let s=createSession(song(2000),1);s.seed=seed;
    if(fixed)s=planRegions(s,s.sections[0].id,[1000]);
    const result=arrange(s,clips);
    assert.deepEqual(ratings(result,clips),[5,5]);assert.equal(new Set(result.placements.map(p=>p.clip_id)).size,2);
    assert.deepEqual(result,arrange(s,clips));variations.add(result.placements.map(p=>p.clip_id).join(','));
  }
  assert.ok(variations.size>1);
});

test('automatic lengths use notes before unrated clips; intensity never changes choices',()=>{
  const s=createSession(song(2500),1),clips=[clip('low-long',0,3000),clip('high',5),clip('middle',4)];
  const first=arrange(s,clips);assert.deepEqual(ratings(first,clips),[5,4,0]);
  const changed=clips.map((c,i)=>({...c,intensity:5-i,intensity_mode:i?'manual':'auto'}));
  assert.deepEqual(arrange(s,changed),first);
  assert.equal(clipIntensity({intensity:5}),5);assert.equal(clipIntensity({intensity:0}),0);
  for(const intensity of [undefined,null,'5',6,-1,2.5])assert.equal(clipIntensity({intensity}),0);
});

test('personal ratings override dataset notes, including explicitly unrated, and cycle mode exhausts footage',()=>{
  const s=createSession(song(2000),2),clips=[{...clip('dataset-five',5),user_rating:0},{...clip('personal-five',2),user_rating:5},clip('four',4)];
  assert.deepEqual(ratings(arrange(s,clips),clips),[5,4]);
  const repeating={...createSession(song(6000),1),repeat_policy:'cycle'};
  const result=arrange(repeating,clips);assert.deepEqual(ratings(result,clips),[5,4,0,5,4,0]);
  for(const chunk of [result.placements.slice(0,3),result.placements.slice(3)])assert.equal(new Set(chunk.map(p=>p.clip_id)).size,3);
});

test('variant rating priority preserves duration feasibility, draft consent and unique video identity',()=>{
  const clips=[{...clip('approved',4,2000),civitai_id:'1',review_status:'approved'},
    {...clip('draft',5,1000),civitai_id:'1',review_status:'draft'}];
  const s=createSession(song(1000),1);
  assert.equal(arrange(s,clips).placements[0].clip_id,'approved');
  s.include_drafts=true;assert.equal(arrange(s,clips).placements[0].clip_id,'draft');
  const longer={...createSession(song(2000),1),include_drafts:true};
  const feasible=arrange(longer,clips);assert.equal(feasible.placements.length,1);assert.equal(feasible.placements[0].clip_id,'approved');
  assert.equal(new Set(feasible.placements.map(p=>videoIdentities(clips).get(p.clip_id))).size,1);
  assert.throws(()=>arrange({...longer,sections:createSession(song(2000),2).sections},clips),/without repeating/);
});

function optimum(sections,clips,i=0,used=0){
  if(i===sections.length)return [0,0];
  let best=null;
  for(let n=0;n<clips.length;n++){
    const c=clips[n];if(used&(1<<n)||!c.categories.includes(sections[i].categories[0]))continue;
    const rest=optimum(sections,clips,i+1,used|(1<<n));if(!rest)continue;
    const score=[rest[0]+clipRating(c),rest[1]+(c.review_status==='draft'?0:1)];
    if(!best||score[0]>best[0]||score[0]===best[0]&&score[1]>best[1])best=score;
  }
  return best;
}
test('weighted matching chooses the highest total note across overlapping folders',()=>{
  let state=91;const random=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};
  for(let trial=0;trial<240;trial++){
    let s=createSession(song(3000),3);s.include_drafts=true;s.seed=trial+1;
    s.sections.forEach(v=>{v.categories=['ABC'[random(3)]];});
    for(const section of s.sections)s=planRegions(s,section.id,[]);
    const clips=Array.from({length:6},(_,i)=>({...clip(String(i),random(6)),categories:[...new Set(['ABC'[random(3)],'ABC'[random(3)]])],review_status:random(3)?'approved':'draft'}));
    const expected=optimum(s.sections,clips);
    if(!expected){assert.throws(()=>arrange(s,clips));continue;}
    const result=arrange(s,clips),selected=result.placements.map(p=>clips.find(c=>c.id===p.clip_id));
    assert.equal(new Set(selected.map(c=>c.id)).size,3);
    assert.deepEqual([selected.reduce((n,c)=>n+clipRating(c),0),selected.filter(c=>c.review_status!=='draft').length],expected);
  }
});
