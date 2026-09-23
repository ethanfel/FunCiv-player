import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComposerService, hash } from '../../electron/composer-service.cjs';
import { createSession, arrange } from '../../packages/composer-core/index.mjs';
import { pendingLocalScripts } from '../../renderer/composer/clip-readiness.js';

const signal=new AbortController().signal;
const script={actions:[{at:0,pos:10},{at:500,pos:90},{at:1000,pos:10}]};
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-assets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const key=hash('civitai:123'),state={commit:'a'.repeat(40),body:JSON.stringify(script),rows:[],calls:[]};
  state.row=(variant='b'.repeat(64))=>({civitai_id:'123',variant_id:variant,duration_ms:1000,categories:['X'],review_status:'draft',quality:5,
    scripts:{L0:{path:`scripts/${key.slice(0,2)}/${key}/${variant}.funscript`,sha256:hash(state.body)}}});
  state.rows=[state.row()];
  const service=await new ComposerService(path.join(root,'data'),{fetchImpl:async url=>{
    state.calls.push(url);const catalog=state.rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:state.commit}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':hash(catalog)}}));
    if(url.endsWith('data/catalog.jsonl'))return new Response(catalog);
    if(url.endsWith('.funscript'))return new Response(state.body);
    throw new Error('Unexpected mock request: '+url);
  }}).init();
  service.probe=async()=>({duration_ms:1000,video:true,width:160,height:90});
  const library=path.join(root,'clips');await fs.mkdir(library);
  const video=path.join(library,'creator_civitai_123_original.mp4');await fs.writeFile(video,'synthetic stat fixture');
  const song={id:'song',name:'Song',path:path.join(root,'song.wav'),duration_ms:1000};await fs.writeFile(song.path,'synthetic audio fixture');service.catalog.songs.push(song);
  await service.scan(library,signal);await service.refreshDataset(signal);
  const hf=()=>service.catalog.clips.find(c=>c.origin==='dataset'&&!c.retired);
  await service.fetchLocalScripts([hf().id],signal);
  const session={...createSession(song,1),include_drafts:true,min_rating:5};
  const saved=await service.saveSession(arrange(session,service.state().clips));
  return {root,service,state,library,video,song,hf,saved};
}

test('unchanged HF scripts survive unrelated commits and both binding formats remain playable',async t=>{
  const {service,state,hf,saved}=await fixture(t),entry=hf();
  const legacy={...saved,asset_bindings:{[entry.id]:{commit:entry.commit,variant:entry.variant_id,size:entry.size,mtime:entry.mtime,scripts:hash(JSON.stringify(entry.scripts))}}};
  const before=await service.prepare(saved);state.commit='c'.repeat(40);state.rows[0].categories=['Renamed'];
  await service.refreshDataset(signal);
  assert.equal(service.state().clips.find(c=>c.id===entry.id).script_ready,true);
  assert.deepEqual((await service.prepare(saved)).snapshot.scripts,before.snapshot.scripts);
  assert.deepEqual((await service.prepare(legacy)).snapshot.scripts,before.snapshot.scripts);
  assert.equal(state.calls.filter(url=>url.endsWith('.funscript')).length,1,'no duplicate script fetch');
  const restarted=await new ComposerService(service.root).init();await restarted.prepare(await restarted.loadSession(saved.id));
});

test('retired draft variants remain addressable across refresh and restart, but leave new pools',async t=>{
  const {service,state,hf,saved}=await fixture(t),original=hf(),originalId=original.id;
  state.commit='c'.repeat(40);state.rows=[{...state.row('d'.repeat(64)),review_status:'approved'}];await service.refreshDataset(signal);
  const retired=service.catalog.clips.find(c=>c.id===originalId);
  assert.ok(retired.retired);assert.equal(retired.commit,'a'.repeat(40));assert.equal(retired.review_status,'draft');
  await service.prepare(saved);
  const restarted=await new ComposerService(service.root).init();await restarted.prepare(await restarted.loadSession(saved.id));
  assert.equal(service.state().dataset.count,1);
  await service.fetchLocalScripts([hf().id],signal);
  const next=arrange(saved,service.state().clips);assert.equal(next.placements[0].clip_id,hf().id);
  const kept=structuredClone(saved);kept.sections[0].locked=true;
  assert.equal(arrange(kept,service.state().clips).placements[0].clip_id,originalId);
  // Historical scripts use the retained commit, even if not cached anymore.
  delete retired.scripts;
  assert.ok(!pendingLocalScripts(service.state().clips,{include_drafts:true,min_rating:0}).some(c=>c.id===originalId));
  const fetched=await service.fetchLocalScripts([originalId],signal);assert.equal(fetched.count,1);assert.equal(fetched.warnings.length,0);
  assert.ok(state.calls.at(-1).includes('/raw/'+'a'.repeat(40)+'/'));await service.prepare(saved);
  // Reappearing entries are restored rather than duplicated.
  state.rows.push(state.row());await service.refreshDataset(signal);
  assert.equal(service.catalog.clips.filter(c=>c.id===originalId).length,1);assert.equal(service.catalog.clips.find(c=>c.id===originalId).retired,false);
});

test('changed script descriptors discard stale cache and cannot silently change saved motion',async t=>{
  const {service,state,hf,saved}=await fixture(t);
  state.commit='c'.repeat(40);state.body=JSON.stringify({actions:[{at:0,pos:50}]});state.rows=[state.row()];
  await service.refreshDataset(signal);assert.equal(service.state().clips.find(c=>c.id===hf().id).script_ready,false);
  await service.fetchLocalScripts([hf().id],signal);
  await assert.rejects(()=>service.prepare(saved),/differs from the saved session/);
  const edited=await service.saveSession({...saved,name:'Keep editing'});
  assert.deepEqual(edited.asset_bindings,saved.asset_bindings);await assert.rejects(()=>service.prepare(edited),/differs from the saved session/);
  await service.prepare(arrange(edited,service.state().clips));
});

test('HF intensity is persistent metadata, independent of rating, bindings and generated motion',async t=>{
  const {service,state,hf,saved}=await fixture(t),id=hf().id;
  assert.equal(hf().intensity,0);assert.equal(hf().intensity_mode,'manual');
  const before=await service.prepare(saved);await service.rate(id,5);
  state.commit='c'.repeat(40);state.rows[0]={...state.rows[0],quality:3,intensity:4,intensity_mode:'auto'};
  await service.refreshDataset(signal);
  const clip=service.state().clips.find(c=>c.id===id);
  assert.equal(clip.quality,3);assert.equal(clip.user_rating,5);assert.equal(clip.intensity,4);assert.equal(clip.intensity_mode,'auto');
  assert.equal(clip.script_ready,true);
  const after=await service.prepare(saved);
  assert.deepEqual(after.snapshot,before.snapshot,'intensity metadata cannot change playback or generated motion');
  assert.deepEqual(after.asset_bindings,before.asset_bindings,'intensity metadata does not invalidate pinned assets');
  const restarted=await new ComposerService(service.root).init(),stored=restarted.state().clips.find(c=>c.id===id);
  assert.equal(stored.intensity,4);assert.equal(stored.intensity_mode,'auto');
  for(const intensity of ['4',null,-1,6,2.5]){
    state.rows[0].intensity=intensity;const previous=service.state();
    await assert.rejects(()=>service.refreshDataset(signal),/Invalid dataset intensity/);assert.deepEqual(service.state(),previous);
  }
  state.rows[0].intensity=3;
  for(const mode of ['estimate',null,1]){
    state.rows[0].intensity_mode=mode;await assert.rejects(()=>service.refreshDataset(signal),/Invalid dataset intensity mode/);
  }
  delete state.rows[0].intensity;delete state.rows[0].intensity_mode;await service.refreshDataset(signal);
  assert.equal(hf().intensity,0);assert.equal(hf().intensity_mode,'manual');
});

test('a downloaded fallback clears old provenance and survives relinking and failed root scans',async t=>{
  const {service,video,hf,library}=await fixture(t),entry=hf();assert.ok(entry.local_video_id);
  await fs.rm(video);
  service.bytes=async()=>Buffer.from(JSON.stringify({items:[{id:123,type:'video',url:'https://image.civitai.com/example/width=160/video.mp4'}]}));
  service.fetchScripts=async()=>({L0:script});service.downloadMedia=async(_url,dest)=>fs.writeFile(dest,'cached video fixture');
  await service.resolveClip(entry.id,'civitai.com',signal);
  assert.equal(entry.video_source,'cache');assert.equal(entry.local_video_id,undefined);await fs.access(entry.path);
  await service.linkLocalClips([entry],signal);assert.equal(entry.available,true);
  entry.local_video_id='legacy-stale-id';await service.linkLocalClips([entry],signal);
  assert.equal(entry.available,true);assert.equal(entry.local_video_id,undefined,'repair stale links from earlier versions');
  await fs.rename(library,library+'-offline');await service.rescan(signal);assert.equal(entry.available,true);
});

test('offline roots preserve metadata, exclude clips, allow saves, and recover after reconnect',async t=>{
  const {service,library,saved}=await fixture(t),local=service.catalog.clips.find(c=>c.origin!=='dataset');
  await service.rate(local.id,4);await service.tag(local.id,'Custom');
  await fs.rename(library,library+'-offline');const result=await service.rescan(signal);
  assert.equal(result.warnings.length,1);assert.equal(service.catalog.root_status[library].available,false);
  assert.ok(service.state().clips.every(c=>!c.available));assert.throws(()=>arrange(saved,service.state().clips),/No usable clips/);
  const edited=await service.saveSession({...saved,name:'Offline edits'});
  assert.equal((await service.loadSession(saved.id)).name,'Offline edits');assert.deepEqual(edited.asset_bindings,saved.asset_bindings);
  await assert.rejects(()=>service.prepare(edited),/ENOENT/);
  await fs.rename(library+'-offline',library);await service.rescan(signal);
  assert.equal(service.catalog.root_status[library].available,true);await service.prepare(edited);
  const found=service.catalog.clips.find(c=>c.id===local.id);assert.equal(found.user_rating,4);assert.deepEqual(found.categories,['Custom']);
  // Permission failures use the same offline state, without dropping records.
  const scan=service.scan;service.scan=async()=>{throw Object.assign(new Error('Permission denied'),{code:'EACCES'});};
  await service.rescan(signal);assert.equal(found.available,false);assert.match(service.catalog.root_status[library].error,/Permission/);
  service.scan=scan;await service.rescan(signal);await service.prepare(edited);
});

test('unresolved recipes save before downloads and session saving captures its input',async t=>{
  const {service,saved,hf}=await fixture(t),entry=hf();
  delete entry.path;delete entry.size;delete entry.mtime;delete entry.scripts;entry.available=false;
  const initial=structuredClone(saved);initial.revision=saved.revision;delete initial.asset_bindings;
  const pending=service.saveSession(initial);initial.name='Mutation after request';const unresolved=await pending;
  assert.notEqual(unresolved.name,initial.name);assert.ok(unresolved.asset_bindings[entry.id].script_hashes);
  await service.linkLocalClips([entry],signal);await service.fetchLocalScripts([entry.id],signal);
  await service.prepare(unresolved);
  const unknown=structuredClone(unresolved);unknown.placements[0].clip_id='temporarily-missing';
  const incomplete=await service.saveSession(unknown);assert.equal(incomplete.placements[0].clip_id,'temporarily-missing');
  await assert.rejects(()=>service.prepare(incomplete),/Resolve the selected clips/);
});
