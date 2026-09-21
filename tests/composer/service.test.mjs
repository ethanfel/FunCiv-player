import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComposerService, hash } from '../../electron/composer-service.cjs';
import { createSession, arrange } from '../../packages/composer-core/index.mjs';

test('local import → arrangement → persisted recipe → real FFmpeg render',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-service-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const service=await new ComposerService(path.join(root,'data')).init(),signal=new AbortController().signal;
  const library=path.join(root,'clips');await fs.mkdir(library);
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=teal:s=160x90:r=30:d=1.2','-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',path.join(library,'clip.mp4')],signal);
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:duration=2.8',path.join(root,'song.wav')],signal);
  const script={actions:[{at:0,pos:10},{at:300,pos:90},{at:600,pos:10},{at:900,pos:90},{at:1200,pos:10}]};
  await fs.writeFile(path.join(library,'clip.funscript'),JSON.stringify(script));
  const result=await service.scan(library,signal);assert.equal(result.count,1);assert.equal(result.warnings.length,0);
  const song=await service.importSong(path.join(root,'song.wav'),signal);assert.equal(song.duration_ms,2800);
  const initial=arrange(createSession(song,2),service.state().clips),saved=await service.saveSession(initial);
  assert.equal(saved.revision,1);assert.deepEqual(await service.loadSession(saved.id),saved);
  await assert.rejects(()=>service.saveSession(initial),/newer saved session/);
  const prepared=await service.prepare(saved);assert.equal(prepared.snapshot.placements.length,4);
  const render=await service.render(saved,signal);
  assert.ok(Math.abs(render.duration_ms-2800)<=100);
  const info=await service.probe(render.path,signal);assert.ok(info.video&&info.audio);assert.equal(info.width,1280);assert.equal(info.height,720);
  const scripts=await service.renderScripts(render.id);assert.deepEqual(scripts,prepared.snapshot.scripts);
  const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(render.path),'manifest.json')));assert.equal(manifest.video_sha256,hash(await fs.readFile(render.path)));
  assert.equal((await fs.readdir(path.dirname(render.path))).filter(n=>n.startsWith('part-')).length,0);
  await fs.writeFile(path.join(library,'clip.funscript'),JSON.stringify({actions:[{at:0,pos:50}]}));
  await assert.rejects(()=>service.prepare(saved),/motion changed/);
  await service.scan(library,signal);await assert.rejects(()=>service.prepare(saved),/differs from the saved session/);
  const adopted=arrange(saved,service.state().clips);await service.prepare(adopted);
  const controller=new AbortController();controller.abort();await assert.rejects(()=>service.render(adopted,controller.signal));
  assert.equal((await fs.readdir(path.join(root,'data','renders'))).length,1,'cancelled render leaves no partial export');
  await assert.rejects(()=>service.deleteRender('../clips'),/Invalid render/);
  await service.deleteRender(render.id);assert.equal((await fs.readdir(path.join(root,'data','renders'))).length,0);
  await fs.access(path.join(library,'clip.mp4'));
});

test('dataset requires catalog checksum and rejects credential redirects',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-network-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const content=Buffer.from('');const commit='a'.repeat(40);
  let calls=[];
  const service=await new ComposerService(root,{fetchImpl:async(url,opts)=>{
    calls.push({url,opts});
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:commit}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':hash(content)}}));
    return new Response(content);
  }}).init();
  await service.refreshDataset();assert.equal(service.state().dataset.commit,commit);
  assert.ok(calls.slice(1).every(c=>c.url.includes(`/raw/${commit}/`)));
  service.fetch=async()=>new Response('',{status:302,headers:{location:'https://example.com/steal'}});
  await assert.rejects(()=>service.bytes('https://civitai.com/api/v1/images',{token:'test-secret'}),/redirected/);
  await assert.rejects(()=>service.bytes('http://127.0.0.1/private'),/Unsupported remote/);
  service.fetch=async url=>new Response(JSON.stringify(url.includes('/api/datasets/')?{sha:commit}:{schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':'wrong'}}));
  await assert.rejects(()=>service.refreshDataset(),/checksum/);
});

test('job cancellation is observable and conflicting jobs are rejected',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-job-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const s=await new ComposerService(root).init();
  const job=s.startJob('wait',signal=>new Promise((resolve,reject)=>{signal.throwIfAborted();signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
  assert.throws(()=>s.startJob('other',async()=>{}),/current task/);s.cancel(job.id);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(s.job(job.id).state,'cancelled');
});
