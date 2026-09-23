import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, arrange, planRegions, validateSession, validateCoverage, videoIdentities } from '../../packages/composer-core/index.mjs';
import { assignUnique } from '../../packages/composer-core/unique-assignment.mjs';
import { draftAssemblyProposal, acceptDraftAssembly } from '../../packages/composer-core/draft-proposal.mjs';

const song=duration_ms=>({id:'song',name:'Fixture',duration_ms});
const clip=(id,categories,duration_ms=1000)=>({id,name:id,categories,duration_ms,available:true,script_ready:true});
const verify=(s,clips)=>{
  validateSession(s,clips);validateCoverage(s);
  const identities=videoIdentities(clips);
  assert.equal(new Set(s.placements.map(p=>identities.get(p.clip_id))).size,s.placements.length);
  for(const p of s.placements){
    const section=s.sections.find(v=>v.id===p.section_id),c=clips.find(v=>v.id===p.clip_id);
    assert.ok(section.categories.some(category=>c.categories.includes(category)));
  }
};

test('overlapping pools find a valid unique arrangement for automatic and fixed regions',()=>{
  const clips=[clip('a',['X']),clip('b',['Y']),clip('z',['X','Y'])];
  for(const fixed of [false,true])for(let seed=1;seed<=20;seed++){
    let s=createSession(song(3000),3);s.seed=seed;s.sections.forEach((v,i)=>{v.categories=[i?'Y':'X'];});
    if(fixed)for(const section of s.sections)s=planRegions(s,section.id,[]);
    const result=arrange(s,clips);verify(result,clips);assert.equal(result.placements[0].clip_id,'a');
    assert.deepEqual(result,arrange(s,clips));
  }
});

// A small independent exhaustive oracle checks feasibility, rather than
// mirroring the planner's matching/heuristic implementation.
function possible(sections,clips,fixed,i=0,remaining=sections[0].end_ms-sections[0].start_ms,used=0,memo=new Set()){
  if(i===sections.length)return true;
  const state=`${i}/${remaining}/${used}`;if(memo.has(state))return false;memo.add(state);
  for(let n=0;n<clips.length;n++){
    const c=clips[n];if(used&(1<<n)||!c.categories.includes(sections[i].categories[0])||fixed&&c.duration_ms<remaining)continue;
    const next=remaining-c.duration_ms;
    if(next>0){if(possible(sections,clips,fixed,i,next,used|(1<<n),memo))return true;}
    else if(i===sections.length-1||possible(sections,clips,fixed,i+1,sections[i+1].end_ms-sections[i+1].start_ms,used|(1<<n),memo))return true;
  }
  return false;
}
test('duration search agrees with exhaustive feasibility for small overlapping pools',()=>{
  let state=18;const random=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};
  for(let trial=0;trial<240;trial++){
    const fixed=trial%2===0;
    let s=createSession(song(3000),3);s.seed=trial+1;s.sections.forEach(v=>{v.categories=['XYZ'[random(3)]];});
    const clips=Array.from({length:6},(_,i)=>clip(String(i),[...new Set(['XYZ'[random(3)],'XYZ'[random(3)]])],500+random(4)*500));
    const feasible=possible(s.sections,clips,fixed);
    if(fixed)for(const section of s.sections)s=planRegions(s,section.id,[]);
    if(feasible)verify(arrange(s,clips),clips);else assert.throws(()=>arrange(s,clips),/without repeating|No usable clips|No clip is long enough/);
  }
});

test('fixed assignment uses approved footage when rerouting can avoid drafts',()=>{
  const s=createSession(song(3000),3);s.include_drafts=true;s.sections.forEach((v,i)=>{v.categories=[i?'Y':'X'];});
  const clips=[clip('a',['X']),clip('b',['Y']),clip('z',['X','Y']),{...clip('draft',['X','Y']),review_status:'draft'}];
  for(let seed=1;seed<=20;seed++){
    s.seed=seed;const result=arrange(s,clips);verify(result,clips);
    assert.ok(result.placements.every(p=>p.clip_id!=='draft'));
  }
});

test('mixed fixed and automatic cuts respect shared video identities, durations and reservations',()=>{
  let s=createSession(song(4000),2);s.sections.forEach(v=>{v.categories=['X'];});
  s=planRegions(s,s.sections[1].id,[3000]);
  const clips=[clip('long',['X'],2000),clip('short',['X'],1000),clip('other',['X'],1000),
    {...clip('long-draft',['X'],3000),civitai_id:'9',review_status:'draft'}];
  clips[0].civitai_id='9';s.include_drafts=true;
  const arranged=arrange(s,clips);verify(arranged,clips);
  arranged.placements.at(-1).locked=true;const kept=structuredClone(arranged.placements.at(-1));
  assert.deepEqual(arrange(arranged,clips).placements.find(p=>p.id===kept.id),kept);
  assert.throws(()=>assignUnique([{section:s.sections[0],pool:clips,start_ms:0,end_ms:2000}],{
    key:id=>id,reserved:new Set(),rng:()=>.5,isDraft:c=>c.review_status==='draft',workLimit:1,
  }),e=>e.code==='ASSEMBLY_SEARCH_LIMIT'&&!e.message.includes('without repeating'));
});

test('draft acceptance commits the offered plan and rejects changed or unready assets',()=>{
  const s=createSession(song(4000),4);s.sections.forEach((v,i)=>{v.categories=[i<2?'X':'Y'];});
  const clips=[['X','Y'],['X','Y'],['X'],['X','Y'],['Y'],['Y']].map((categories,i)=>({
    ...clip(String(i),categories),origin:'dataset',review_status:i?'draft':'approved',script_ready:i===0,remote_scripts:{L0:{}},
  }));
  const proposal=draftAssemblyProposal(s,clips);assert.ok(proposal);assert.ok(proposal.fetchIds.length);
  assert.throws(()=>acceptDraftAssembly(proposal,clips),/no longer ready/);
  const ready=clips.map(c=>({...c,script_ready:c.script_ready||proposal.fetchIds.includes(c.id)}));
  const accepted=acceptDraftAssembly(proposal,ready);
  assert.deepEqual(accepted,proposal.assembled);assert.notEqual(accepted,proposal.assembled);verify(accepted,ready);
  const selected=accepted.placements[0].clip_id;
  for(const changes of [{path:'/new/file.mp4'},{available:false},{categories:['Other']},{duration_ms:900},{retired:true}]){
    assert.throws(()=>acceptDraftAssembly(proposal,ready.map(c=>c.id===selected?{...c,...changes}:c)));
  }
  assert.equal(s.include_drafts,false);assert.deepEqual(s.placements,[]);
});
