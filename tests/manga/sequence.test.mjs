import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fixture,write} from './fixtures.mjs';
import {joinedTakes} from './sequence-fixture.mjs';
import {MangaService} from '../../electron/manga-service.cjs';
import {manifest,applyUpdate,rollbackUpdate} from '../../electron/manga-archive.cjs';
import {applyH3Sequence,nextReadingPage,takeVariant} from '../../packages/manga-core/sequence.mjs';
import {validateBook} from '../../packages/manga-core/book.mjs';

test('joined sequence selects only matching takes, survives portable updates, and restores single panels on unpair',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'manga-joins-'));
  try{
    const {service,project}=await fixture(root);const original=await service.open(project);
    const {file,pair,base}=await joinedTakes(project);assert.equal(await service.changed(original.id),true,'creating a sequence is watched');
    const sequenceBefore=await fs.readFile(file,'utf8');let book=await service.open(project),panel=book.pages[1].panels[0];
    assert.equal(book.pages[1].panels.length,1,'endpoint is not a second clip');assert.equal(panel.selected,'take_0003','main take wins over newer matching and unrelated takes');
    assert.deepEqual(panel.takes.map(t=>t.id),['take_0004','take_0003']);assert.deepEqual(panel.joined.sourcePanelIds,['panel_1','panel_2']);
    assert.equal(await service.changed(book.id),false);
    const stale={[panel.id]:{take:'take_0001'}},run=await service.prepare(book.id,1,{},stale);
    assert.equal(run.segments.length,1);assert.equal(run.duration_ms,2000);assert.equal(run.scripts.L0.actions[0].pos,20,'stale override uses H3 selection, not a single-panel take');
    const chosen=await service.prepare(book.id,1,{}, {[panel.id]:{take:'take_0004'}});assert.equal(chosen.scripts.L0.actions[0].pos,60,'an explicit eligible override still works');
    await service.saveReader(book.id,{settings:{},overrides:stale});
    const archive=path.join(root,'joined.fcmanga');await service.exportPackage(book.id,archive,{alternates:true},new AbortController().signal);
    const exported=(await manifest(archive)).book;assert.equal(exported.minReaderVersion,3);assert.equal(exported.pages[1].panels.length,1);assert.equal(exported.overrides[panel.id].take,'take_0003');assert.equal(exported.pages[1].panels[0].takes.length,2);
    const damaged=structuredClone(exported);damaged.pages[1].panels[0].takes[0].flfVariant='flf_2222222222222222';assert.throws(()=>validateBook(damaged),/joined-panel/);
    const other=await new MangaService(path.join(root,'reader')).init(),portable=await other.openPackage(archive);
    const portableRun=await other.prepare(book.id,1,{},portable.overrides);assert.equal(portableRun.segments.length,1);assert.deepEqual(portableRun.scripts,run.scripts);
    assert.equal(await fs.readFile(file,'utf8'),sequenceBefore,'imports and exports leave H3 sequencing untouched');
    await write(path.join(base,'main_take.json'),{take_id:'take_0001'});book=await service.open(project);assert.equal(book.pages[1].panels[0].selected,'take_0004','ineligible main falls back to newest matching take');
    await write(file,{schema_version:1,pairs:[{...pair,variant:'flf_3333333333333333'}]});assert.equal(await service.changed(book.id),true);
    book=await service.open(project);assert.equal(book.pages[1].panels[0].selected,null);assert.equal(book.pages[1].panels[0].takes.length,0);assert.ok(book.issues.some(s=>s.includes('no completed take')));
    const missing=await service.prepare(book.id,1,{},stale);assert.equal(missing.segments.length,1);assert.equal(missing.segments[0].kind,'still');assert.equal(missing.scripts.L0.actions.length,0);assert.ok(missing.warnings.some(s=>s.includes('no matching video')));
    assert.equal(run.segments[0].kind,'video','prepared runs remain snapshots after changing the pair');
    await write(file,{schema_version:1,pairs:[]});book=await service.open(project);
    assert.deepEqual(book.pages[1].panels.map(p=>p.sourceId),['panel_1','panel_2']);assert.deepEqual(book.pages[1].panels[0].takes.map(t=>t.id),['take_0001'],'old joined takes cannot return after unpairing');
    const update=path.join(root,'unpaired.fcmanga-update');await service.exportPackage(book.id,update,{basePackage:archive},new AbortController().signal);
    await applyUpdate(other,book.id,update);assert.equal((await other.prepare(book.id,1,{})).segments.length,2);
    await rollbackUpdate(other,book.id);assert.equal((await other.prepare(book.id,1,{})).segments.length,1);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('cross-page joins preserve surrounding order and skip fully consumed pages without skipping real still pages',()=>{
  const panel=id=>({sourceId:id,takes:[],selected:null});
  const a=panel('a'),b=panel('b'),c=panel('c'),d=panel('d');
  const pages=[{panels:[a,b]},{panels:[c]},{panels:[]},{panels:[d]}],folders=new Map([['a',a],['b',b],['c',c],['d',d]]),issues=[];
  applyH3Sequence(pages,{schema_version:1,pairs:[{variant:'flf_1111111111111111',endpoints:[{panel_id:'a',folder:'a'},{panel_id:'c',folder:'c'}]}]},folders,issues);
  assert.deepEqual(pages.map(p=>p.panels.map(p=>p.sourceId)),[['a','b'],[],[],['d']]);assert.equal(pages[1].joinedOnly,true);assert.equal(pages[2].joinedOnly,undefined);
  assert.equal(nextReadingPage(pages,0),2);assert.equal(nextReadingPage(pages,2),3);assert.equal(nextReadingPage(pages,3),-1);
});

test('stale, malformed and overlapping joins cannot consume unrelated current panels',()=>{
  const a={sourceId:'a',takes:[]},b={sourceId:'b',takes:[]},c={sourceId:'c',takes:[]},pages=[{panels:[a,b,c]}],folders=new Map([['a',a],['b',b],['c',c]]),issues=[];
  const pair=(x,y)=>({variant:'flf_1111111111111111',endpoints:[{panel_id:x,folder:x},{panel_id:y,folder:y}]});
  applyH3Sequence(pages,{schema_version:1,pairs:[null,{...pair('a','b'),endpoints:[{panel_id:'a',folder:'old-layout/a'},{panel_id:'b',folder:'b'}]},pair('a','b'),pair('c','b')]},folders,issues);
  assert.deepEqual(pages[0].panels.map(p=>p.sourceId),['a','c']);assert.equal(c.joined,undefined);assert.ok(issues.some(s=>s.includes('Invalid joined-panel')));assert.equal(issues.filter(s=>s.includes('old layout')).length,2);
  assert.throws(()=>takeVariant({settings:{reference_position:'flf_1111111111111111'},flf_pair:{variant:'flf_2222222222222222'}}),/identity/);
});
