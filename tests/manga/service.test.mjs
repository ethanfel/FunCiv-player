import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixture,write} from './fixtures.mjs';
import {MangaService,inside} from '../../electron/manga-service.cjs';
test('H3 selected takes, measured duration, source immutability, and portable round trip',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manga-test-'));
 try{const {service,project}=await fixture(root),before=await fs.readFile(path.join(project,'project.json'),'utf8'),book=await service.open(project);
  const still=await service.prepare(book.id,0,{stillSeconds:7});assert.equal(still.duration_ms,7000);assert.equal(still.segments[0].pageStill,true);assert.equal(still.scripts.L0.actions.length,0);assert.ok(await fs.stat(await service.file(new URL(still.segments[0].static).pathname.slice(1))));
  assert.equal(book.pages.length,2);assert.equal(book.pages[0].panels.length,0);assert.equal(book.pages[1].panels[0].selected,'take_0001');assert.equal(book.pages[1].panels[0].takes.find(t=>t.id==='take_0001').durationMs,2000);
  const ahead=await service.prepare(book.id,1,{mode:'loop',extraSeconds:1},{},true);
  const probe=service.probe,pin=service.pin;let run;
  try{service.probe=service.pin=async()=>{throw new Error('Prepared page must not repeat disk work');};run=await service.prepare(book.id,1,{mode:'loop',extraSeconds:1,ignoreBubbleTiming:true});assert.equal(run,ahead,'ignoring bubble timing preserves the prepared run');}finally{service.probe=probe;service.pin=pin;}
assert.equal(run.segments.length,4);assert.equal(run.segments[2].motion,false);
  assert.equal(await service.changed(book.id),false);
  const selected=book.pages[1].panels[0].takes.find(t=>t.id==='take_0001'),asset=service.assets.get(selected.media),cached=new URL(run.segments[0].media).pathname.slice(1);await fs.utimes(asset.file,new Date(),new Date(Date.now()+1000));
  assert.ok(await fs.stat(await service.file(cached)),'prepared media stays usable after source changes');
  await fs.utimes(asset.file,new Date(),new Date(asset.mtime));await service.open(project);
  await write(path.join(project,'pages/page_0002/layouts/rev2/panels/panel_2/takes/take_0001/video_clean.funscript'),{actions:[{at:0,pos:20},{at:2000,pos:20}]});assert.equal(await service.changed(book.id),true);await fs.rm(path.join(project,'pages/page_0002/layouts/rev2/panels/panel_2/takes/take_0001/video_clean.funscript'));
  await service.saveReader(book.id,{settings:{mode:'loop',extraSeconds:1,ignoreBubbleTiming:true},overrides:{}});
  const file=path.join(root,'book.fcmanga');await service.exportPackage(book.id,file,{},new AbortController().signal);assert.ok((await fs.stat(file)).size>1000);
  const alternates=path.join(root,'alternates.fcmanga');await service.exportPackage(book.id,alternates,{alternates:true},new AbortController().signal);const {manifest}=await import('../../electron/manga-archive.cjs'),edition=await manifest(alternates);assert.equal(edition.book.pages[1].panels[0].takes.length,2);assert.ok(edition.book.pages[1].panels[0].takes.every(t=>t.durationMs===2000),'alternate takes use measured timing instead of stale render metadata');
  await fs.rename(project,project+'-moved');const other=await new MangaService(path.join(root,'other')).init(),portable=await other.openPackage(file);
  assert.equal(portable.pages[1].panels[0].takes.length,1);assert.equal(portable.presentation.mode,'loop');assert.equal(portable.presentation.ignoreBubbleTiming,true);const p=await other.prepare(portable.id,1,{mode:'none'});assert.equal(p.duration_ms,4000);assert.equal(p.scripts.L0.actions.find(a=>a.at===250).pos,80);
  assert.equal(await fs.readFile(path.join(project+'-moved','project.json'),'utf8'),before);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('root escapes rejected and a damaged take does not hide static pages',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manga-bad-'));
 try{const {service,project}=await fixture(root,{media:false});await assert.rejects(()=>inside(project,'../outside'),/leaves/);
  service.probe=async()=>({durationMs:2000,width:320,height:180,audio:false});await write(path.join(project,'pages/page_0002/layouts/rev2/panels/panel_1/takes/take_0003/render.json'),{panel_id:'panel_1',video:'../../../../../../../../etc/passwd'});
  const book=await service.open(project);assert.equal(book.pages.length,2);assert.equal(book.pages[1].panels[0].selected,'take_0001');assert.ok(book.issues.length);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
