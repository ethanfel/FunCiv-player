import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fixture,write} from './fixtures.mjs';
import {MangaService} from '../../electron/manga-service.cjs';
import {applyUpdate,rollbackUpdate,manifest} from '../../electron/manga-archive.cjs';
test('small updates bind to the exact edition, persist, and roll back',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manga-update-'));
 try{const {service,project}=await fixture(root),book=await service.open(project),base=path.join(root,'base.fcmanga'),update=path.join(root,'update.fcmanga-update');
  await service.exportPackage(book.id,base,{},new AbortController().signal);
  const file=path.join(project,'pages/page_0002/layouts/rev2/panels/panel_1/takes/take_0001/video_clean.funscript');await write(file,{actions:[{at:0,pos:40},{at:500,pos:60},{at:1000,pos:40},{at:1500,pos:60},{at:2000,pos:40}]});
  await service.open(project);await service.exportPackage(book.id,update,{basePackage:base},new AbortController().signal);
  assert.ok((await fs.stat(update)).size<(await fs.stat(base)).size/2);assert.ok((await fs.readFile(base)).includes(Buffer.from([0x50,0x4b,6,6])),'ZIP64 archive');
  const reader=await new MangaService(path.join(root,'reader')).init();await reader.openPackage(base);await assert.rejects(()=>applyUpdate(reader,book.id,base),/different book edition/);await applyUpdate(reader,book.id,update);
  let run=await reader.prepare(book.id,1,{});assert.equal(run.scripts.L0.actions.find(a=>a.at===500).pos,60);
  await assert.rejects(()=>applyUpdate(reader,book.id,update),/different book edition/);
  await rollbackUpdate(reader,book.id);run=await reader.prepare(book.id,1,{});assert.equal(run.scripts.L0.actions.find(a=>a.at===500).pos,20);
  await applyUpdate(reader,book.id,update);const reopened=await new MangaService(path.join(root,'reader')).init();await reopened.reopen('package:'+book.id);run=await reopened.prepare(book.id,1,{});assert.equal(run.scripts.L0.actions.find(a=>a.at===500).pos,60);
  await assert.rejects(()=>manifest(update),/Apply update/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('audio suggestion measures the selected take without modifying it',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manga-audio-'));
 try{const {service,project}=await fixture(root),book=await service.open(project),panel=book.pages[1].panels[0],value=await service.analyzeAudio(book.id,panel.id,panel.selected);assert.ok(Number.isFinite(value.mean));assert.ok(value.gain>0&&value.gain<=2);
  const run=await service.prepare(book.id,1,{},Object.fromEntries(book.pages[1].panels.map((p,i)=>[p.id,{order:1-i}])));assert.equal(run.segments[0].panelId,book.pages[1].panels[1].id);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
