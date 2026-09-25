import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {animatorBubbleLayers,validateBubbleLayers,bubbleState} from '../../packages/manga-core/bubbles.mjs';
import {MangaService} from '../../electron/manga-service.cjs';
import {manifest,applyUpdate,rollbackUpdate} from '../../electron/manga-archive.cjs';
import {validateBook} from '../../packages/manga-core/book.mjs';
import {fixture,write,timedBubbles} from './fixtures.mjs';
const timeline=()=>({schema_version:1,fps:24,frames:48,size:[320,180],tracks:[
 {id:'first',image:'first.png',enabled:true,start_frame:6,end_frame:24,transition:{enter:'fade',enter_frames:6}},
 {id:'last',image:'last.png',enabled:true,start_frame:24,end_frame:48,transition:{enter:'pop',enter_frames:6,exit:'slide_right',exit_frames:6}},
 {id:'hidden',image:'hidden.png',enabled:false,start_frame:0,end_frame:48}
]});

test('saved Animator frames override applied layers and preserve exclusive ends and hidden tracks',()=>{
 const layers=animatorBubbleLayers({bubble_layers:[]},timeline());assert.equal(layers.length,2);
 assert.equal(bubbleState(layers[0],.249).visible,false);assert.equal(bubbleState(layers[0],.25).visible,true);assert.equal(bubbleState(layers[0],.25).opacity,0);
 assert.equal(bubbleState(layers[0],.375).opacity,.5);assert.equal(bubbleState(layers[0],.5).opacity,1);
 assert.equal(bubbleState(layers[0],1).visible,false);assert.equal(bubbleState(layers[1],1).visible,true);
 assert.ok(Math.abs(bubbleState(layers[1],1.125).scale-.91)<1e-12);assert.equal(bubbleState(layers[1],2).visible,false);
 assert.ok(bubbleState(layers[1],47/24).x>0);assert.equal(bubbleState(layers[1],47/24).opacity,0);
 const hidden=timeline();hidden.tracks.forEach(t=>t.enabled=false);assert.deepEqual(animatorBubbleLayers({},hidden),[]);
 assert.equal(animatorBubbleLayers({bubble_layer:'old.png'}),undefined);
 const old=animatorBubbleLayers({bubble_layers:[{image:'first.png',start_seconds:0,end_seconds:1},{image:'last.png',start_seconds:1}]});
 assert.equal(bubbleState(old[0],1).visible,false);assert.equal(bubbleState(old[1],20).visible,true);
 assert.deepEqual(animatorBubbleLayers({bubble_layers:[]}),[]);
});

test('short intervals clamp transition length and invalid timing/assets cannot enter portable manifests',()=>{
 const row={...animatorBubbleLayers({},timeline())[0],end_frame:8,end_seconds:8/24};
 assert.equal(bubbleState(row,6/24).opacity,1,'two-frame intervals stay readable instead of fading to nothing');
 for(const change of [t=>t.fps=0,t=>t.tracks[0].end_frame=49,t=>t.tracks[0].start_frame=25,t=>t.tracks[0].enabled='false',t=>t.tracks[1].id='first',t=>t.tracks[0].transition.enter='unknown',t=>t.tracks[0].transition.enter_frames=121]){
  const data=timeline();change(data);assert.throws(()=>animatorBubbleLayers({},data));
 }
 assert.throws(()=>validateBubbleLayers([{image:'a',start_seconds:0,end_seconds:NaN}]),/interval/);
 const book={schema:'funciv-manga/1',direction:'ltr',assets:{video:{}},pages:[{id:'page',width:1,height:1,panels:[{id:'panel',bbox:[0,0,1,1],takes:[{id:'take',durationMs:2000,media:'video',clean:'video',bubbleLayers:animatorBubbleLayers({},timeline())}]}]}]};
 assert.throws(()=>validateBook(book),/undeclared asset/);
});

test('bubble timing is watched, pinned, portable and retained through package updates and rollback',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manga-bubbles-'));
 try{
  const {service,project}=await fixture(root);const timing=await timedBubbles(project,service),before=await fs.readFile(timing.file,'utf8');
  const book=await service.open(project),take=book.pages[1].panels[0].takes.find(t=>t.id==='take_0001');
  assert.equal(take.bubbleLayers.length,2);assert.equal(take.overlay,null);assert.equal(take.bubbleTimingSource,'saved');
  assert.ok(take.bubbleLayers.every(r=>book.assets[r.image]));assert.equal(await service.changed(book.id),false);
  const run=await service.prepare(book.id,1,{mode:'loop',extraSeconds:1});assert.equal(run.segments[0].baked,null);
  assert.deepEqual(run.segments[1].bubbleLayers,run.segments[0].bubbleLayers);
  const copied=new URL(run.segments[0].bubbleLayers[0].image).pathname.slice(1);assert.ok(await fs.stat(await service.file(copied)));
  const base=path.join(root,'book.fcmanga');await service.exportPackage(book.id,base,{},new AbortController().signal);
  const edition=await manifest(base);assert.equal(edition.book.minReaderVersion,2);assert.equal(edition.book.pages[1].panels[0].takes[0].bubbleLayers.length,2);
  assert.equal(await fs.readFile(timing.file,'utf8'),before,'import/preparation/export leave Animator timing unchanged');
  const latest=JSON.parse(before);latest.tracks[0].start_frame=12;await write(timing.file,latest);assert.equal(await service.changed(book.id),true);
  assert.equal(run.segments[0].bubbleLayers[0].start_seconds,.25,'prepared page retains original timing');
  await service.open(project);const patch=path.join(root,'update.fcmanga-update');await service.exportPackage(book.id,patch,{basePackage:base},new AbortController().signal);
  await fs.rename(project,project+'-offline');
  const other=await new MangaService(path.join(root,'reader')).init(),portable=await other.openPackage(base);
  let prepared=await other.prepare(portable.id,1,{mode:'extend',extraSeconds:1});assert.equal(prepared.segments[0].bubbleLayers[0].start_seconds,.25);
  assert.deepEqual(prepared.segments[1].bubbleLayers,prepared.segments[0].bubbleLayers);
  await applyUpdate(other,portable.id,patch);prepared=await other.prepare(portable.id,1,{});assert.equal(prepared.segments[0].bubbleLayers[0].start_seconds,.5);
  await rollbackUpdate(other,portable.id);prepared=await other.prepare(portable.id,1,{});assert.equal(prepared.segments[0].bubbleLayers[0].start_seconds,.25);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('damaged or missing timed layers fall back to applied bubbles without losing the clean take',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'manga-bubble-fallback-'));
 try{
  const {service,project}=await fixture(root,{media:false});service.probe=async()=>({durationMs:2000,width:320,height:180});
  const dir=path.join(project,'pages/page_0002/layouts/rev2/panels/panel_1/takes/take_0001'),file=path.join(dir,'render.json');
  const render=JSON.parse(await fs.readFile(file));render.bubble_layers=[{image:'takes/take_0001/bubble_overlay.png',start_seconds:.5}];await write(file,render);
  const bad=timeline();bad.tracks[0].image='../../../../../../../../../../etc/passwd';await write(path.join(dir,'bubble_timeline.json'),bad);
  let book=await service.open(project),take=book.pages[1].panels[0].takes.find(t=>t.id==='take_0001');
  assert.equal(take.bubbleTimingSource,'applied');assert.equal(take.bubbleLayers[0].start_seconds,.5);assert.ok(book.issues.some(i=>i.includes('saved bubble timing unavailable')));
  render.bubble_layers[0].image='missing.png';await write(file,render);book=await service.open(project);take=book.pages[1].panels[0].takes.find(t=>t.id==='take_0001');
  assert.ok(take.clean&&take.baked);assert.equal(take.bubbleLayers,undefined);assert.equal(take.overlay,null);assert.ok(book.issues.some(i=>i.includes('using the bubbles-on video')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
