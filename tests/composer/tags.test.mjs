import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSession, arrange, planRegions, validateSession, clipRating, History } from '../../packages/composer-core/index.mjs';
import { normalizeTags, normalizeTagSources, clipTagIndex, effectiveTagPreferences, tagPreferenceScore } from '../../packages/composer-core/tags.mjs';
import { replaceClip, remakeSection } from '../../packages/composer-core/variations.mjs';
import { createMusic } from '../../packages/composer-core/music.mjs';
import { tagChoices } from '../../renderer/composer/tag-picker.js';
import { ComposerService, hash } from '../../electron/composer-service.cjs';

const song=duration_ms=>({id:'song',name:'Tag fixture',duration_ms});
const clip=(id,quality=5,tags=[],duration_ms=1000)=>({id,name:id,quality,tags,duration_ms,categories:['A'],available:true,script_ready:true});
const prefs=(prefer=[],less=[])=>({prefer:[...prefer].sort(),less:[...less].sort()});

test('tags normalize consistently and published source labels cannot resurrect removed tags',()=>{
  assert.deepEqual(normalizeTags(['Blue_Hair',' blue   hair ','ＧＬＡＳＳＥＳ','']),['blue hair','glasses']);
  assert.deepEqual(normalizeTagSources({civitai:['blue_hair','removed'],local:['glasses']},['blue hair','glasses']),{civitai:['blue hair'],local:['glasses']});
  for(const invalid of [null,'tag',[123],['x'.repeat(121)],['hidden\0tag'],Array(501).fill('tag')])assert.throws(()=>normalizeTags(invalid));
  for(const invalid of [null,[],{'invalid source':['blue hair']},{local:'blue hair'}])assert.throws(()=>normalizeTagSources(invalid,[]));
});
test('section preferences inherit, add with local precedence, replace or switch off',()=>{
  const s={tag_preferences:prefs(['blue hair','glasses'],['outdoors'])};
  assert.deepEqual(effectiveTagPreferences(s,{}),s.tag_preferences);
  assert.deepEqual(effectiveTagPreferences(s,{tag_preferences:{mode:'add',...prefs(['outdoors'],['glasses'])}}),prefs(['blue hair','outdoors'],['glasses']));
  assert.deepEqual(effectiveTagPreferences(s,{tag_preferences:{mode:'replace',...prefs(['indoors'])}}),prefs(['indoors']));
  assert.deepEqual(effectiveTagPreferences(s,{tag_preferences:{mode:'off',...prefs()}}),prefs());
  const session=createSession(song(1000),1);session.tag_preferences=prefs(['blue hair']);validateSession(session);
  for(const invalid of [null,{prefer:['Blue_Hair'],less:[]},prefs(['a'],['a']),{prefer:Array(33).fill('a'),less:[]}]){
    session.tag_preferences=invalid;assert.throws(()=>validateSession(session));
  }
});
test('linked variants share current tags, and picker counts unique eligible videos',()=>{
  const clips=[{...clip('local'),civitai_id:'123'}, {...clip('remote',5,['blue hair']),civitai_id:'123',origin:'dataset',review_status:'draft'},
    {...clip('retired',5,['outdated']),civitai_id:'123',retired:true},clip('other',3,['blue hair']),{...clip('offline',5,['blue hair']),available:false}];
  const index=clipTagIndex(clips);assert.deepEqual(index.get('local'),['blue hair']);assert.deepEqual(index.get('remote'),['blue hair']);
  const s=createSession(song(1000),1);s.min_rating=4;
  assert.deepEqual(tagChoices(clips,s,s.sections[0]),[{tag:'blue hair',total:3,pool:1}]);
  s.tag_preferences=prefs(['blue hair']);assert.equal(arrange(s,clips).placements[0].clip_id,'local','draft metadata does not require using the draft script');
});
test('tags break rating ties for automatic/fixed/cycle assembly, never filter required footage or create repeats',()=>{
  for(const fixed of [false,true])for(const repeat_policy of ['never','cycle']){
    let s=createSession(song(2000),1);s.tag_preferences=prefs(['blue hair'],['outdoors']);s.repeat_policy=repeat_policy;
    if(fixed)s=planRegions(s,s.sections[0].id,[1000]);
    const clips=[clip('matching',5,['blue hair']),clip('plain'),clip('less',5,['outdoors']),clip('four',4,['blue hair'])];
    assert.deepEqual(new Set(arrange(s,clips).placements.map(p=>p.clip_id)),new Set(['matching','plain']));
    s.tag_preferences=prefs(['missing'],['blue hair','outdoors']);
    const required=arrange(s,clips.slice(0,2));assert.equal(new Set(required.placements.map(p=>p.clip_id)).size,2);
    assert.deepEqual(arrange(s,clips),arrange(s,clips),'tag choices remain deterministic for a seed');
  }
  const s=createSession(song(1000),1);s.tag_preferences=prefs(['blue hair']);
  assert.equal(arrange(s,[clip('five'),clip('four',4,['blue hair'])]).placements[0].clip_id,'five');
  assert.equal(arrange(s,[{...clip('unrated',5,['blue hair']),user_rating:0},clip('four',4)]).placements[0].clip_id,'four');
});
test('soft preferences preserve fallback, folder filters, kept clips, draft opt-in and 4–12s pacing',()=>{
  let s=createSession(song(16000),1);s.auto_clip={min_ms:4000,max_ms:12000};s.tag_preferences=prefs(['blue hair']);s.min_rating=4;
  const clips=[clip('preferred',5,['blue hair'],12000),clip('backup',5,[],12000),{...clip('draft',5,['blue hair'],12000),review_status:'draft'},
    {...clip('wrong-folder',5,['blue hair'],12000),categories:['B']},clip('too-short',5,['blue hair'],500)];
  s.sections[0].categories=['A'];const result=arrange(s,clips);assert.deepEqual(new Set(result.placements.map(p=>p.clip_id)),new Set(['preferred','backup']));
  assert.ok(result.placements.every(p=>p.end_ms-p.start_ms>=4000&&p.end_ms-p.start_ms<=12000));
  result.sections[0].locked=true;result.tag_preferences=prefs([],['blue hair']);assert.deepEqual(arrange(result,clips).placements,result.placements);
});
function bestAssignment(s,clips,i=0,used=new Set()){
  if(i===s.sections.length)return [0,0,0];let best=null;
  for(const c of clips){
    if(used.has(c.id)||!c.categories.includes(s.sections[i].categories[0]))continue;
    const rest=bestAssignment(s,clips,i+1,new Set([...used,c.id]));if(!rest)continue;
    const score=[rest[0]+clipRating(c),rest[1]+tagPreferenceScore(c.tags,effectiveTagPreferences(s,s.sections[i])),rest[2]+Number(c.review_status!=='draft')];
    const difference=best&&score.findIndex((n,j)=>n!==best[j]);if(!best||difference>=0&&score[difference]>best[difference])best=score;
  }return best;
}
test('fixed-cut matching maximizes ratings before tag totals across overlapping section pools',()=>{
  let state=13;const random=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};
  for(let trial=0;trial<180;trial++){
    let s=createSession(song(3000),3);s.include_drafts=true;s.tag_preferences=prefs(['blue hair']);
    for(const section of s.sections){section.categories=['ABC'[random(3)]];section.tag_preferences={mode:'add',...prefs(['t'+random(3)],['less'])};}
    for(const section of s.sections)s=planRegions(s,section.id,[]);
    const clips=Array.from({length:6},(_,i)=>({...clip(String(i),random(6),[random(2)?'blue hair':'less','t'+random(3)]),categories:[...new Set(['ABC'[random(3)],'ABC'[random(3)]])],review_status:random(3)?'approved':'draft'}));
    const expected=bestAssignment(s,clips);if(!expected){assert.throws(()=>arrange(s,clips));continue;}
    const result=arrange(s,clips),chosen=result.placements.map(p=>clips.find(c=>c.id===p.clip_id));
    assert.deepEqual([chosen.reduce((n,c)=>n+clipRating(c),0),chosen.reduce((n,c,i)=>n+tagPreferenceScore(c.tags,effectiveTagPreferences(s,s.sections[i])),0),chosen.filter(c=>c.review_status!=='draft').length],expected);
  }
});
test('replacement and remake honor tags while preserving full-song music and neighboring sections',()=>{
  let s=createSession(song(4000),2);s.tag_preferences=prefs(['blue hair']);
  for(const section of s.sections)s=planRegions(s,section.id,[]);
  const clips=[clip('a',5,[],2000),clip('b',5,[],2000),clip('tagged',5,['blue hair'],2000),clip('spare',5,[],2000)];
  s=arrange(s,clips.slice(0,2));s.music=createMusic();s.music.blocks=[{id:'music',start:0,end:4000,settings:s.music.settings,actions:[{at:0,pos:10},{at:4000,pos:90}]}];
  const before=structuredClone(s),history=new History();history.record(s);
  const replaced=replaceClip(s,s.placements[0].id,clips);assert.equal(replaced.placements[0].clip_id,'tagged');assert.deepEqual(replaced.music,before.music);assert.deepEqual(replaced.placements[1],before.placements[1]);
  const remade=remakeSection(s,s.sections[0].id,clips);assert.equal(remade.placements[0].clip_id,'tagged');assert.deepEqual(remade.music,before.music);
  assert.deepEqual(history.undo(replaced),before);
});
test('HF tag refresh persists normalized metadata, keeps verified scripts and never changes bindings',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-tags-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let metadata={},revision='a';
  const script={sha256:'c'.repeat(64),path:'scripts/test.funscript'};
  const fetchImpl=async url=>{
    const content=JSON.stringify({civitai_id:'123',variant_id:'b'.repeat(64),duration_ms:1000,quality:5,review_status:'approved',categories:['A'],scripts:{L0:script},...metadata})+'\n';
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:revision.repeat(40)}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':hash(content)}}));
    return new Response(content);
  };
  const service=await new ComposerService(root,{fetchImpl}).init();await service.refreshDataset();assert.deepEqual(service.state().clips[0].tags,[]);
  service.catalog.clips[0].scripts={L0:{actions:[{at:0,pos:10}]}};const bindings=service.bindings(service.catalog.clips),id=service.catalog.clips[0].id;
  await service.rate(id,4);await service.tag(id,'My folder');metadata={tags:['BLUE_HAIR','glasses','blue hair'],tag_sources:{local:['glasses'],civitai:['blue_hair','removed']}};revision='d';
  await service.refreshDataset();assert.deepEqual(service.state().clips[0].tags,['blue hair','glasses']);assert.deepEqual(service.catalog.clips[0].tag_sources,{local:['glasses'],civitai:['blue hair']});
  assert.deepEqual(service.bindings(service.catalog.clips),bindings);assert.ok(service.state().clips[0].script_ready);assert.equal(service.state().clips[0].user_rating,4);assert.deepEqual(service.state().clips[0].categories,['My folder']);
  const s=createSession(song(1000),1);s.tag_preferences=prefs(['blue hair']);s.sections[0].tag_preferences={mode:'add',...prefs(['glasses'])};
  const saved=await service.saveSession(s),reopened=await new ComposerService(root,{fetchImpl}).init();assert.deepEqual((await reopened.loadSession(saved.id)).tag_preferences,s.tag_preferences);assert.deepEqual(reopened.state().clips[0].tags,['blue hair','glasses']);
  const before=reopened.state();for(const invalid of [{tags:'blue hair'},{tags:[42]},{tags:['x'.repeat(121)]},{tags:[],tag_sources:null}]){metadata=invalid;await assert.rejects(()=>reopened.refreshDataset());assert.deepEqual(reopened.state(),before);}
  metadata={tags:[],tag_sources:{local:[]}};await reopened.refreshDataset();assert.deepEqual(reopened.state().clips[0].tags,[]);assert.deepEqual(reopened.bindings(reopened.catalog.clips),bindings);
});
test('draft and audio-sync records can gain tags on a later metadata sync without downloading scripts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-tags-publisher-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let published=false;const requests=[];
  const fetchImpl=async url=>{
    requests.push(url);
    const content=[false,true].flatMap(audio_sync=>['draft','approved'].map((review_status,i)=>({
      civitai_id:String((audio_sync?200:100)+i),variant_id:'a'.repeat(64),duration_ms:1000,quality:5,audio_sync,review_status,scripts:{},
      ...(published?{tags:['Blue_Hair'],tag_sources:{local:['Blue_Hair']}}:{})
    }))).map(row=>JSON.stringify(row)).join('\n')+'\n';
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:(published?'b':'a').repeat(40)}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':hash(content)}}));
    assert.ok(url.endsWith('data/catalog.jsonl'));return new Response(content);
  };
  const service=await new ComposerService(root,{fetchImpl}).init();await service.refreshDataset();
  const before=service.state().clips.map(c=>({id:c.id,audio_sync:c.audio_sync,review_status:c.review_status}));
  assert.ok(service.state().clips.every(c=>c.tags.length===0));
  published=true;await service.refreshDataset();
  assert.deepEqual(service.state().clips.map(c=>({id:c.id,audio_sync:c.audio_sync,review_status:c.review_status})),before);
  assert.ok(service.state().clips.every(c=>c.tags.join()==='blue hair'));assert.equal(requests.length,6);
});
