import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSession, arrange, planRegions, validateSession, History } from '../../packages/composer-core/index.mjs';
import { normalizeSourceMetadata, clipMetadataIndex, sourceValues, matchesSourceFilters, sourceFilterConflicts } from '../../packages/composer-core/source-metadata.mjs';
import { replaceClip, remakeSection } from '../../packages/composer-core/variations.mjs';
import { draftAssemblyProposal, acceptDraftAssembly } from '../../packages/composer-core/draft-proposal.mjs';
import { sourceChoices, sourceMetadataHTML } from '../../renderer/composer/source-filters.js';
import { tagChoices } from '../../renderer/composer/tag-picker.js';
import { folderReadiness } from '../../renderer/composer/clip-readiness.js';
import { ComposerService, hash } from '../../electron/composer-service.cjs';

const song=duration_ms=>({id:'song',name:'Source fixture',duration_ms});
const clip=(id,creator_username='Alice',overrides={})=>({id,name:id,duration_ms:12000,quality:5,available:true,script_ready:true,categories:['A'],creator_username,
  civitai_metadata:{base_model:'Model One',content_rating:'Mature',width:1080,height:1920},...overrides});

test('public Civitai metadata is bounded, normalizes optional fields and reconstructs trusted page URLs',()=>{
  const value=normalizeSourceMetadata({civitai_id:'123',creator_username:' Alice_AI ',post_id:'456',civitai_metadata:{
    base_model:'Model One',content_rating:'Mature',width:1080,height:1920,model_version_ids:['9',8,'9'],stats:{likeCount:12,heartCount:3,unexpected:42},
    created_at:'2026-09-24T10:00:00Z',fetched_at:'2026-09-24T10:00:00.123456+00:00',site:'civitai.red',creator_url:'javascript:bad()',video_url:'https://untrusted.test/private',prompt:'not imported'
  }});
  assert.equal(value.creator_username,'Alice_AI');assert.equal(value.civitai_metadata.creator_url,'https://civitai.red/user/Alice_AI/images');
  assert.equal(value.civitai_metadata.video_url,'https://civitai.red/images/123');assert.equal(value.civitai_metadata.post_url,'https://civitai.red/posts/456');
  assert.deepEqual(value.civitai_metadata.model_version_ids,['8','9']);assert.deepEqual(value.civitai_metadata.stats,{likeCount:12,heartCount:3});assert.equal(value.civitai_metadata.prompt,undefined);
  assert.deepEqual(normalizeSourceMetadata({}),{creator_username:null,post_id:null,civitai_metadata:{}});
  for(const invalid of [{creator_username:3},{creator_username:'x'.repeat(201)},{post_id:'../123'},{civitai_metadata:[]},{civitai_metadata:{width:0}},{civitai_metadata:{height:1.5}},{civitai_metadata:{stats:{likeCount:-1}}},{civitai_metadata:{created_at:'yesterday'}},{civitai_metadata:{model_version_ids:[null]}}])assert.throws(()=>normalizeSourceMetadata(invalid));
});

test('newest current metadata reaches linked local copies, counts once, and clears without reviving old fields',()=>{
  const local={...clip('local',undefined),civitai_metadata:undefined,path:'/video.mp4'},remote={...clip('remote','Alice'),path:'/video.mp4',origin:'dataset',review_status:'draft',civitai_metadata:{...clip().civitai_metadata,fetched_at:'2026-09-24T10:00:00Z'}};
  const older={...remote,id:'older',creator_username:'Old',civitai_metadata:{...remote.civitai_metadata,fetched_at:'2026-09-23T10:00:00Z'}};
  const retired={...remote,id:'retired',creator_username:'Retired',retired:true,civitai_metadata:{fetched_at:'2026-09-25T10:00:00Z'}};
  const clips=[local,remote,older,retired,clip('bob','Bob')],index=clipMetadataIndex(clips);
  assert.equal(sourceValues(local,index).creators,'Alice');assert.equal(sourceChoices(clips,index).creators.find(r=>r.key==='alice').count,1);
  const session=createSession(song(1000),1);session.source_filters={creators:['alice']};assert.equal(arrange(session,clips).placements[0].clip_id,'local');
  remote.creator_username=null;remote.civitai_metadata={fetched_at:'2026-09-24T10:00:00Z'};
  assert.equal(sourceValues(local,clipMetadataIndex(clips)).creators,'');assert.equal(sourceValues(local,clipMetadataIndex(clips)).base_models,'');
  const onlyRetired=[local,retired];assert.notEqual(sourceValues(local,clipMetadataIndex(onlyRetired)).creators,'Retired');
});

test('source filters use OR within fields, AND across fields, strict narrowing and explicit unknown values',()=>{
  const s=createSession(song(2000),1),section=s.sections[0],a=clip('a'),b=clip('b','Bob'),unknown=clip('u',null,{civitai_metadata:{}});
  s.source_filters={creators:['alice','bob'],base_models:['model one'],orientations:['portrait'],min_short_edge:1080};validateSession(s);
  assert.ok(matchesSourceFilters(a,s,section));assert.ok(matchesSourceFilters(b,s,section));assert.equal(matchesSourceFilters(unknown,s,section),false);
  section.source_filters={mode:'narrow',creators:['bob']};assert.equal(matchesSourceFilters(a,s,section),false);assert.ok(matchesSourceFilters(b,s,section));
  section.source_filters={mode:'narrow',creators:['charlie']};assert.equal(matchesSourceFilters(a,s,section),false);assert.equal(matchesSourceFilters(b,s,section),false,'disjoint lists never become Any');
  section.source_filters={mode:'replace',creators:[''],orientations:['']};assert.ok(matchesSourceFilters(unknown,s,section));
  section.source_filters={mode:'off'};assert.ok(matchesSourceFilters(unknown,s,section));
  assert.equal(matchesSourceFilters(clip('small','Alice',{civitai_metadata:{width:720,height:1280}}),{source_filters:{min_short_edge:1080}}),false);
  for(const invalid of [null,{creators:'alice'},{creators:['Alice']},{creators:['alice','alice']},{orientations:['wide']},{min_short_edge:-1},{min_short_edge:2.5}]){s.source_filters=invalid;assert.throws(()=>validateSession(s));}
});

test('creator filters constrain automatic, fixed, cycle and scoped selection without changing pacing or repeat rules',()=>{
  const clips=[clip('a'),clip('b'),clip('c','Bob'),clip('d','Bob')];
  for(const repeat_policy of ['never','cycle'])for(const fixed of [false,true]){
    let s=createSession(song(16000),1);s.auto_clip={min_ms:4000,max_ms:12000};s.repeat_policy=repeat_policy;s.source_filters={creators:['alice']};
    if(fixed)s=planRegions(s,s.sections[0].id,[8000]);
    const selected=arrange(s,clips);assert.deepEqual(new Set(selected.placements.map(p=>p.clip_id)),new Set(['a','b']));
    assert.ok(selected.placements.every(p=>p.end_ms-p.start_ms>=4000&&p.end_ms-p.start_ms<=12000));
    if(!fixed||repeat_policy==='never')assert.throws(()=>arrange(s,clips.slice(1)),/different|source filters|repeating/);
    else assert.ok(arrange(s,clips.slice(1)).placements.every(p=>p.clip_id==='b'),'explicit cycle mode can reuse a video for manual cuts');
  }
  let s=createSession(song(4000),2);s.source_filters={creators:['alice']};for(const section of s.sections)s=planRegions(s,section.id,[]);
  s.sections[1].source_filters={mode:'replace',creators:['bob']};s=arrange(s,clips);
  const replaced=replaceClip(s,s.placements[0].id,clips);assert.equal(clips.find(c=>c.id===replaced.placements[0].clip_id).creator_username,'Alice');assert.notEqual(replaced.placements[0].clip_id,s.placements[0].clip_id);
  const remade=remakeSection(s,s.sections[1].id,clips);assert.equal(clips.find(c=>c.id===remade.placements[1].clip_id).creator_username,'Bob');assert.deepEqual(remade.placements[0],s.placements[0]);
  const history=new History();history.record(s);s.source_filters={creators:['missing']};assert.ok(sourceFilterConflicts(s,clips).length);assert.deepEqual(history.undo(s).source_filters,{creators:['alice']});
  s.sections[0].locked=true;assert.throws(()=>arrange(s,clips),/Unlock.*source filters/);s.sections[0].locked=false;s.placements[0].locked=true;assert.throws(()=>arrange(s,clips),/kept clip.*source filters/);
});

test('draft proposals retain source restrictions and reject metadata changed during script fetching',()=>{
  const s=createSession(song(1000),1);s.source_filters={creators:['alice']};
  const clips=[clip('draft','Alice',{origin:'dataset',review_status:'draft'}),clip('approved','Bob',{review_status:'approved'})];
  const proposal=draftAssemblyProposal(s,clips);assert.ok(proposal);assert.equal(proposal.assembled.placements[0].clip_id,'draft');assert.ok(acceptDraftAssembly(proposal,clips));
  assert.throws(()=>acceptDraftAssembly(proposal,[{...clips[0],creator_username:'Bob'},clips[1]]),/changed/);
  assert.equal(draftAssemblyProposal({...s,source_filters:{creators:['missing']}},clips),null);
});

test('folder and tag pool counts reflect source restrictions and metadata is escaped in clip details',()=>{
  const s=createSession(song(1000),1);s.source_filters={creators:['alice']};const clips=[clip('a','Alice',{tags:['glasses']}),clip('b','Bob',{tags:['glasses']})];
  assert.deepEqual(tagChoices(clips,s,s.sections[0]),[{tag:'glasses',total:2,pool:1}]);
  const folder=folderReadiness(clips,s,s.sections[0]);assert.equal(folder.ready,1);assert.ok(folder.reasons.includes('1 outside source filters'));
  const html=sourceMetadataHTML(clip('x','<img src=x onerror=alert(1)>'));assert.equal(html.includes('<img'),false);assert.ok(html.includes('&lt;img'));
});

test('metadata refresh persists source fields and filter recipes without touching verified scripts, bindings or personal ratings',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-source-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let source={creator_username:'Alice',post_id:'456',civitai_metadata:{site:'civitai.red',base_model:'Model One',width:1080,height:1920}};
  const fetchImpl=async url=>{
    const content=JSON.stringify({civitai_id:'123',variant_id:'a'.repeat(64),duration_ms:1000,review_status:'draft',audio_sync:true,quality:5,scripts:{L0:{sha256:'b'.repeat(64),path:'scripts/test.funscript'}},...source})+'\n';
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:'c'.repeat(40)}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':hash(content)}}));
    assert.ok(url.endsWith('data/catalog.jsonl'));return new Response(content);
  };
  const service=await new ComposerService(root,{fetchImpl}).init();await service.refreshDataset();const id=service.catalog.clips[0].id;
  service.catalog.clips[0].scripts={L0:{actions:[{at:0,pos:50}]}};await service.rate(id,4);const binding=service.bindings(service.catalog.clips);
  source.creator_username='Bob';await service.refreshDataset();assert.equal(service.state().clips[0].creator_username,'Bob');assert.equal(service.state().clips[0].script_ready,true);assert.equal(service.state().clips[0].user_rating,4);assert.deepEqual(service.bindings(service.catalog.clips),binding);
  const session=createSession(song(1000),1);session.source_filters={creators:['bob'],min_short_edge:720};session.sections[0].source_filters={mode:'narrow',orientations:['portrait']};
  const saved=await service.saveSession(session),reopened=await new ComposerService(root,{fetchImpl}).init();assert.deepEqual((await reopened.loadSession(saved.id)).source_filters,session.source_filters);assert.deepEqual((await reopened.loadSession(saved.id)).sections[0].source_filters,session.sections[0].source_filters);assert.equal(reopened.state().clips[0].creator_username,'Bob');
  const before=reopened.state();source={civitai_metadata:{width:-10}};await assert.rejects(()=>reopened.refreshDataset());assert.deepEqual(reopened.state(),before);
  source={};await reopened.refreshDataset();assert.equal(reopened.state().clips[0].creator_username,null);assert.deepEqual(reopened.state().clips[0].civitai_metadata,{});assert.deepEqual(reopened.bindings(reopened.catalog.clips),binding);
});
