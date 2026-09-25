import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {write} from './fixtures.mjs';
import {joinedTakes} from './sequence-fixture.mjs';

export async function checkJoinedSequence(page,project){
  const projectFile=path.join(project,'project.json'),layoutFile=path.join(project,'pages/page_0002/layouts/rev2/layout.json');
  const original=JSON.parse(await fs.readFile(projectFile,'utf8')),layout=JSON.parse(await fs.readFile(layoutFile,'utf8'));
  const {pair,file}=await joinedTakes(project);
  await page.evaluate(async()=>{const c=window.app.manga;await c.action('back');await c.page(1);c.settings={...c.settings,mode:'none',autoplay:'manual',readBefore:true};c.overrides={[c.book.pages[1].panels[0].id]:{take:'take_0001'}};await c.save();});
  await page.locator('.mg [data-action=refresh]').click();
  await page.waitForFunction(()=>!window.app.manga.busy&&window.app.manga.book.pages[1].panels.length===1);
  assert.equal(await page.locator('.mg-hotspot').count(),1,'only the opening panel starts the joined clip');
  await page.locator('.mg-hotspot').click();await page.waitForFunction(()=>window.app.manga.player.segment?.kind==='video'&&!window.app.manga.player.switching);
  const selection=await page.evaluate(()=>{const c=window.app.manga;return {id:c.take().id,available:c.panel().takes.map(t=>t.id),segments:c.run.segments.length,value:c.root.querySelector('[data-panel-field=take]').value};});
  assert.deepEqual(selection,{id:'take_0003',available:['take_0004','take_0003'],segments:1,value:'take_0003'});
  assert.match(await page.locator('.mg-panel-title').textContent(),/Joined panels/);
  // A later page containing only the other endpoint must not introduce a still
  // timer between the joined clip and the next genuine page in reading order.
  const endpointFolder='pages/page_0003/layouts/rev3/panels/panel_2';
  await fs.cp(path.join(project,pair.endpoints[1].folder),path.join(project,endpointFolder),{recursive:true});
  await write(layoutFile,{panels:[layout.panels[0]]});
  for(const [id,revision,panels] of [['page_0003','rev3',[{panel_id:'panel_2',folder:endpointFolder}]],['page_0004','rev4',[]]]){
    const relative=`pages/${id}/layouts/${revision}/layout.json`;await write(path.join(project,'pages',id,'current.json'),{layout:relative});await write(path.join(project,relative),{panels});
  }
  await write(projectFile,{...original,pages:[...original.pages,{...original.pages[1],page_id:'page_0003',source_sha256:'third'},{...original.pages[0],page_id:'page_0004',source_sha256:'fourth'}]});
  await write(file,{schema_version:1,pairs:[{...pair,endpoints:[pair.endpoints[0],{panel_id:'panel_2',folder:endpointFolder}]}]});
  await page.evaluate(async()=>{const c=window.app.manga;c.settings.autoplay='continuous';c.settings.stillSeconds=30;await c.save();});
  await page.locator('.mg [data-action=refresh]').click();await page.waitForFunction(()=>!window.app.manga.busy&&window.app.manga.book.pages.length===4);
  const empty=await page.evaluate(async()=>{const c=window.app.manga,r=await c.ipc('prepare',{id:c.book.id,page:2,settings:c.settings});return {covered:c.book.pages[2].joinedOnly,segments:r.segments.length,duration:r.duration_ms};});
  assert.deepEqual(empty,{covered:true,segments:0,duration:0});
  await page.evaluate(async()=>{const c=window.app.manga;await c.focusPanel(c.book.pages[1].panels[0].id,1,false);});
  await page.waitForFunction(()=>window.app.manga.ahead?.page===3&&window.app.manga.ahead.run);
  await page.locator('.mg [data-action=play]').click();await page.waitForFunction(()=>window.app.manga.pageIndex===3&&window.app.manga.player.running,{},{timeout:12000});
  assert.equal(await page.evaluate(()=>window.app.manga.player.segment.kind),'still','autoplay reaches the next genuine still page');
  await page.locator('.mg [data-action=stop]').click();
  await write(projectFile,original);await write(layoutFile,layout);await write(file,{schema_version:1,pairs:[]});
  await page.locator('.mg [data-action=refresh]').click();await page.waitForFunction(()=>!window.app.manga.busy&&window.app.manga.book.pages.length===2);
  await page.evaluate(async()=>{const c=window.app.manga;c.settings={...c.settings,autoplay:'page',readBefore:false};await c.page(1);});
  assert.equal(await page.locator('.mg-hotspot').count(),2,'unpairing restores source panels');
  assert.deepEqual(await page.evaluate(()=>window.app.manga.book.pages[1].panels[0].takes.map(t=>t.id)),['take_0001'],'unpairing excludes archived FLF takes');
  console.log('PASS Manga joined panels: refresh, compatible take choices, one playback entry, cross-page prefetch/autoplay, skipped endpoint-only page, unpair restore.');
}
