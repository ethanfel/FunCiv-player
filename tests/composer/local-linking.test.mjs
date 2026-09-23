import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComposerService, hash } from '../../electron/composer-service.cjs';
import { clipReadiness, folderReadiness, pendingLocalScripts } from '../../renderer/composer/clip-readiness.js';

test('scanning before or after HF sync links local videos and only exact script variants',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-links-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const signal=new AbortController().signal,library=path.join(root,'library'),calls=[];
  await fs.mkdir(library);
  const key=hash('civitai:123'),variant='b'.repeat(64),script=JSON.stringify({actions:[{at:0,pos:10},{at:500,pos:90},{at:1000,pos:10}]}),twist=JSON.stringify({actions:[{at:0,pos:40},{at:1000,pos:60}]});
  let commit='a';
  const scripts={L0:{path:`scripts/${key.slice(0,2)}/${key}/${variant}.funscript`,sha256:hash(script)},R0:{path:`scripts/${key.slice(0,2)}/${key}/${variant}.twist.funscript`,sha256:hash(twist)}};
  const row={civitai_id:'123',variant_id:variant,duration_ms:1000,quality:5,review_status:'draft',categories:['HF category'],scripts};
  const fetchImpl=async url=>{
    calls.push(url);assert.ok(url.startsWith('https://huggingface.co/'),'no Civitai video download');
    const content=JSON.stringify(row)+'\n';
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:commit.repeat(40)}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':hash(content)}}));
    if(url.endsWith('data/catalog.jsonl'))return new Response(content);
    return new Response(url.endsWith('.twist.funscript')?twist:script);
  };
  const service=await new ComposerService(path.join(root,'data'),{fetchImpl}).init();
  const video=path.join(library,'creator_civitai_123_original.mp4');
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=teal:s=160x90:r=30:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',video],signal);
  await fs.writeFile(video.replace('.mp4','.funscript'),script);
  await service.refreshDataset();const id=service.state().clips[0].id,remote=()=>service.state().clips.find(c=>c.id===id);
  assert.equal(remote().available,false);
  const scan=await service.scan(library,signal);assert.equal(scan.linked,1);
  assert.equal(remote().path,video);assert.equal(remote().available,true);assert.equal(remote().script_ready,false,'missing twist sidecar cannot silently become neutral');
  assert.deepEqual(remote().categories,['HF category']);assert.equal(remote().review_status,'draft');assert.equal(remote().quality,5);
  assert.equal(calls.length,3,'scanning is local and needs no second metadata sync');
  await fs.writeFile(video.replace('.mp4','.twist.funscript'),twist);await service.scan(library,signal);
  assert.equal(remote().script_ready,true);assert.deepEqual(remote().axes,['L0','R0']);assert.equal(calls.length,3,'matching sidecars avoid all script downloads');
  const scannedFirst=await new ComposerService(path.join(root,'other'),{fetchImpl}).init();
  await scannedFirst.scan(library,signal);await scannedFirst.refreshDataset();
  assert.equal(scannedFirst.state().clips.find(c=>c.id===id).script_ready,true,'scan then sync works too');
  await service.tag(id,'Custom');await service.rate(id,4);await service.scan(library,signal);
  assert.deepEqual(remote().categories,['Custom']);assert.equal(remote().user_rating,4);
  // Same filename/duration, different script: only the published checksums identify a variant.
  await fs.writeFile(video.replace('.mp4','.funscript'),JSON.stringify({actions:[{at:0,pos:50}]}));
  service.catalog.clips.find(c=>c.id===id).scripts=undefined;await service.scan(library,signal);
  assert.equal(remote().script_ready,false);
  const count=calls.length,result=await service.fetchLocalScripts([id,id],signal);
  assert.equal(result.count,1);assert.deepEqual(result.warnings,[]);assert.equal(calls.length-count,2);
  assert.equal(remote().script_ready,true);assert.deepEqual(remote().categories,['Custom']);assert.equal(remote().review_status,'draft');
  assert.equal(await fs.readFile(video.replace('.mp4','.funscript'),'utf8'),JSON.stringify({actions:[{at:0,pos:50}]}),'fetching caches HF scripts without overwriting the local edit');
  // A moved video is relinked without changing the remote ID, categories or ratings.
  const moved=path.join(library,'moved_civitai_123_original.mp4');await fs.rename(video,moved);await service.scan(library,signal);
  assert.equal(remote().path,moved);assert.equal(remote().available,true);assert.equal(remote().user_rating,4);
  await fs.rm(moved);await service.scan(library,signal);assert.equal(remote().available,false,'deleted local files lose their ready state');
  const before=calls.length;const missing=await service.fetchLocalScripts([id],signal);assert.equal(missing.count,0);assert.equal(missing.warnings.length,1);assert.equal(calls.length,before);
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=gray:s=160x90:r=30:d=2','-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',moved],signal);
  await service.scan(library,signal);assert.equal(remote().available,false,'same ID with incompatible duration is not linked');
  commit='c';await service.refreshDataset();assert.equal(remote().available,false);assert.equal(remote().script_ready,true,'unchanged verified scripts survive unrelated HF commits, even while video is offline');
  assert.deepEqual(remote().categories,['Custom']);assert.equal(remote().user_rating,4);
});

test('folder readiness explains local files, script fetching and overlapping exclusions',()=>{
  const session={include_drafts:false,min_rating:4},section={motion:'clip'};
  const base={origin:'dataset',review_status:'approved',quality:5,available:true,remote_scripts:{L0:{}}};
  const clips=[{...base,script_ready:true},{...base},{...base,available:false},{...base,available:false,path:'/missing.mp4'},
    {...base,script_ready:true,review_status:'draft',quality:3},{...base,remote_scripts:{}}];
  const status=folderReadiness(clips,session,section);
  assert.equal(status.total,6);assert.equal(status.ready,1);
  assert.deepEqual(status.reasons,['1 video not linked','1 local video unavailable','1 needs HF scripts','1 has no motion script','1 draft excluded','1 below 4★']);
  assert.deepEqual(pendingLocalScripts(clips,session),[clips[1]]);
  assert.equal(clipReadiness({...base,audio_sync:true},session,section).ready,true);
  assert.equal(folderReadiness(clips,session,{motion:'song'}).ready,3,'song motion does not require downloaded scripts');
  assert.equal(folderReadiness(clips,{include_drafts:true,min_rating:0},section).ready,2);
});
