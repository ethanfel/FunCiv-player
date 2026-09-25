import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, arrange, planRegions, validateSession, validateCoverage, DEFAULT_AUTO_CLIPS, videoIdentities } from '../../packages/composer-core/index.mjs';
import { replaceClip, remakeSection } from '../../packages/composer-core/variations.mjs';

const clip=(id,quality=5)=>({id,name:id,path:`/clips/Collection/A/${id}.mp4`,duration_ms:20000,quality,available:true,script_ready:true,categories:['A']});
function fixture(){
  const clips=Array.from({length:12},(_,i)=>clip(`clip-${i}`));
  const recipe={...createSession({id:'song',name:'Song',duration_ms:24000},3),auto_clip:{...DEFAULT_AUTO_CLIPS}};
  const session=arrange(recipe,clips);session.asset_bindings={old:true};
  return {session,clips,section:session.sections[1],selected:session.placements[2]};
}
const otherRows=(s,id)=>s.placements.filter(p=>p.section_id!==id);
const signature=s=>s.placements.map(p=>[p.clip_id,p.start_ms,p.end_ms,p.source_in_ms,p.rate]);
function unique(s,clips){
  const ids=videoIdentities(clips);
  assert.equal(new Set(s.placements.map(p=>ids.get(p.clip_id))).size,s.placements.length);
  assert.equal(new Set(s.placements.map(p=>p.id)).size,s.placements.length);
}

test('replacing a kept clip changes only its source, preserving span, speed and all other sections',()=>{
  const {session,clips,section,selected}=fixture();selected.rate=1.5;selected.source_in_ms=1000;selected.locked=true;
  section.planned_regions=true;
  const used=new Set(session.placements.map(p=>p.clip_id));
  for(const c of clips)if(!used.has(c.id))c.quality=3;
  const best=clips.find(c=>!used.has(c.id));best.quality=5;
  const before=structuredClone(session),catalog=structuredClone(clips),next=replaceClip(session,selected.id,clips),p=next.placements.find(p=>p.id===selected.id);
  assert.equal(p.clip_id,best.id);assert.deepEqual([p.start_ms,p.end_ms,p.rate,p.locked],[selected.start_ms,selected.end_ms,1.5,true]);
  assert.ok(p.source_in_ms+(p.end_ms-p.start_ms)*p.rate<=best.duration_ms);
  assert.deepEqual(next.placements.filter(p=>p.id!==selected.id),session.placements.filter(p=>p.id!==selected.id));
  assert.deepEqual(next.sections,session.sections);assert.equal(next.seed,session.seed+1);assert.equal(next.asset_bindings,undefined);
  assert.deepEqual(session,before);assert.deepEqual(clips,catalog);assert.deepEqual(next,replaceClip(session,selected.id,clips));
  validateSession(next,clips);validateCoverage(next);unique(next,clips);
});

test('replacement excludes aliases of the current/used videos and honors folders, stars, drafts and motion',()=>{
  const {session,clips,section,selected}=fixture();session.min_rating=4;
  section.categories=['A'];section.folders=[{source:'local',path:'/clips/Collection'}];
  const used=clips.filter(c=>session.placements.some(p=>p.clip_id===c.id));
  const rejected=[{...used[2],id:'current-alias'}, {...used[0],id:'used-alias'},
    {...clip('outside'),path:'/clips/Other/outside.mp4'}, {...clip('category'),categories:['B']},
    {...clip('draft'),origin:'dataset',review_status:'draft',local_video_id:'linked-draft'}, {...clip('low'),quality:3},
    {...clip('short'),duration_ms:1000}, {...clip('offline'),available:false},
    {...clip('no-motion'),script_ready:false}, {...clip('retired'),retired:true}];
  assert.throws(()=>replaceClip(session,selected.id,[...used,...rejected]),/No different video/);
  const allowed={...clip('audio-sync',4),script_ready:false,audio_sync:true};
  const next=replaceClip(session,selected.id,[...used,...rejected,allowed]);
  assert.equal(next.placements.find(p=>p.id===selected.id).clip_id,'audio-sync');
  session.include_drafts=true;
  assert.equal(replaceClip(session,selected.id,[...used,...rejected]).placements.find(p=>p.id===selected.id).clip_id,'draft');
});

test('replacement failure is atomic; cycle mode may reuse another video but never the current one',()=>{
  const {session,clips,selected}=fixture(),used=clips.filter(c=>session.placements.some(p=>p.clip_id===c.id)),before=structuredClone(session);
  assert.throws(()=>replaceClip(session,selected.id,used),/No different video/);assert.deepEqual(session,before);
  const next=replaceClip({...session,repeat_policy:'cycle'},selected.id,used);
  assert.notEqual(next.placements.find(p=>p.id===selected.id).clip_id,selected.clip_id);
  assert.throws(()=>replaceClip(session,'missing',clips),/Select a clip/);
  session.sections[1].locked=true;assert.throws(()=>replaceClip(session,selected.id,clips),/Unlock this section/);
});

test('remake uses fresh videos in only the selected section, retaining 4–12s pacing and no repeats',()=>{
  const {session,clips,section}=fixture(),before=structuredClone(session),next=remakeSection(session,section.id,clips);
  assert.deepEqual(otherRows(next,section.id),otherRows(session,section.id));assert.deepEqual(next.sections,session.sections);
  const old=new Set(session.placements.map(p=>p.clip_id)),changed=next.placements.filter(p=>p.section_id===section.id);
  assert.ok(changed.length>=2);assert.ok(changed.every(p=>!old.has(p.clip_id)&&p.end_ms-p.start_ms>=4000&&p.end_ms-p.start_ms<=12000));
  assert.equal(changed[0].start_ms,8000);assert.equal(changed.at(-1).end_ms,16000);
  assert.equal(next.asset_bindings,undefined);assert.deepEqual(session,before);assert.deepEqual(next,remakeSection(session,section.id,clips));
  validateSession(next,clips);validateCoverage(next);unique(next,clips);
});

test('remake preserves manual cuts and kept clips exactly, without validating unrelated unfinished sections',()=>{
  const {session,clips,section}=fixture();
  let s=planRegions(session,section.id,[8500,12000]);
  s=arrange(s,clips);const rows=s.placements.filter(p=>p.section_id===section.id);rows[0].locked=true;rows[0].source_in_ms=123;
  s.sections[0].planned_regions=true;s.placements.filter(p=>p.section_id===s.sections[0].id).forEach(p=>{p.clip_id=null;p.source_in_ms=0;});
  const kept=structuredClone(rows[0]),next=remakeSection(s,section.id,clips),newRows=next.placements.filter(p=>p.section_id===section.id);
  assert.deepEqual(newRows[0],kept);assert.deepEqual(newRows.map(p=>[p.id,p.start_ms,p.end_ms,p.rate]),rows.map(p=>[p.id,p.start_ms,p.end_ms,p.rate]));
  assert.deepEqual(otherRows(next,section.id),otherRows(s,section.id));assert.deepEqual(next.sections,s.sections);
  validateSession(next,clips);
});

test('remake can use one spare lower-rated video when there is not enough footage for a fully fresh section',()=>{
  const {session,clips,section}=fixture(),used=clips.filter(c=>session.placements.some(p=>p.clip_id===c.id));
  for(const [i,p] of session.placements.entries())used.find(c=>c.id===p.clip_id).quality=i%2?4:5;
  const spare=clip('spare',3),next=remakeSection(session,section.id,[...used,spare]);
  assert.ok(next.placements.some(p=>p.section_id===section.id&&p.clip_id==='spare'));
  assert.ok(next.placements.some(p=>p.section_id===section.id&&p.clip_id===session.placements[2].clip_id),'preserve the stronger existing clip');
  assert.deepEqual(otherRows(next,section.id),otherRows(session,section.id));unique(next,[...used,spare]);
});

test('remake can reshuffle a small pool and reports unchanged layouts and kept sections honestly',()=>{
  const {session,clips,section}=fixture(),used=clips.filter(c=>session.placements.some(p=>p.clip_id===c.id));
  const next=remakeSection(session,section.id,used);assert.notDeepEqual(signature(next),signature(session));unique(next,used);
  const manual=planRegions(session,section.id,[]);
  manual.placements=manual.placements.map(p=>p.section_id===section.id?{...p,clip_id:session.placements[2].clip_id,source_in_ms:0}:p);
  const exact=used.map(c=>({...c,duration_ms:8000}));
  assert.throws(()=>remakeSection(manual,section.id,exact.filter(c=>c.id!==session.placements[3].clip_id)),/No different arrangement/);
  section.locked=true;assert.throws(()=>remakeSection(session,section.id,clips),/Unlock this section/);
  section.locked=false;section.planned_regions=true;session.placements.filter(p=>p.section_id===section.id).forEach(p=>p.locked=true);
  assert.throws(()=>remakeSection(session,section.id,clips),/Every clip.*kept/);
});

test('remake fills an empty selected section and avoids generated ID collisions with split neighbors',()=>{
  const {session,clips,section}=fixture();
  delete session.auto_clip; // Legacy recipes still get the UI's 4–12s default.
  session.placements=session.placements.filter(p=>p.section_id!==section.id);
  session.placements[0].id=`${section.id}-0`;
  const before=structuredClone(session),next=remakeSection(session,section.id,clips);
  assert.deepEqual(otherRows(next,section.id),otherRows(session,section.id));assert.deepEqual(session,before);
  assert.equal(next.placements.filter(p=>p.section_id===section.id).length,2);
  validateSession(next,clips);validateCoverage(next);unique(next,clips);
});
