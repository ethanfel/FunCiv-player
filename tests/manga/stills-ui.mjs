import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {write} from './fixtures.mjs';

// Exercise animated -> still panel -> consecutive whole still pages using the
// real importer, clock and controls. Only the disposable fixture is modified.
export async function checkStillReading(page,project){
  const projectFile=path.join(project,'project.json'),original=await fs.readFile(projectFile,'utf8');
  const takes=path.join(project,'pages/page_0002/layouts/rev2/panels/panel_2/takes');
  const metadata=JSON.parse(original);
  await fs.rename(takes,takes+'-saved');
  try{
    for(const number of [3,4]){
      const id=`page_000${number}`,image=`pages/${id}/source.png`,layout=`pages/${id}/layouts/static/layout.json`;
      await write(path.join(project,`pages/${id}/current.json`),{layout});await write(path.join(project,layout),{panels:[]});
      await fs.copyFile(path.join(project,'pages/page_0001/source.png'),path.join(project,image));
      metadata.pages.push({page_id:id,width:320,height:360,image});
    }
    await write(projectFile,metadata);
    await page.locator('.mg [data-action=refresh]').click();await page.waitForFunction(()=>window.app.manga.book?.pages.length===4);
    await page.locator('.mg [data-action=play]').click();await page.waitForFunction(()=>window.app.manga.player.running&&window.app.manga.player.position>100);
    assert.equal(await page.locator('.mg-focus').isVisible(),false,'whole-page reading keeps the original page visible');
    assert.match(await page.locator('.mg-play-state').textContent(),/Still page.*remaining/);
    assert.equal(await page.evaluate(()=>window.app.manga.player.segment.duration),10000);
    assert.equal(await page.evaluate(()=>window.app.manga.player.wrapper.paused&&window.app.manga.player.videos.every(v=>v.paused)),true);
    await page.locator('.mg [data-action=play]').click();const paused=await page.evaluate(()=>window.app.manga.player.position);
    await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.app.manga.player.position),paused);
    await page.locator('.mg [data-field=bubbles]').uncheck();assert.equal(await page.evaluate(()=>window.app.manga.player.position),paused);
    await page.locator('.mg [data-action=refresh]').click();await page.waitForFunction(t=>window.app.manga.run?.segments[0]?.pageStill&&!window.app.manga.busy&&window.app.manga.player.position===t,paused);
    assert.equal(await page.evaluate(()=>window.app.manga.player.intent),false,'restored countdown stays paused');
    await page.locator('.mg [data-field=bubbles]').check();
    await page.locator('.mg-header [data-action=details]').click();
    await page.locator('.mg [data-setting=stillSeconds]').fill('1');await page.locator('.mg [data-setting=stillSeconds]').dispatchEvent('change');
    await page.locator('.mg [data-setting=autoplay]').selectOption('continuous');
    await page.locator('.mg [data-action=play]').click();
    await page.waitForFunction(()=>window.app.manga.pageIndex===1&&window.app.manga.player.segment?.kind==='video');
    await page.waitForFunction(()=>window.app.manga.pageIndex===1&&window.app.manga.player.segment?.kind==='still'&&window.app.manga.player.running);
    assert.match(await page.locator('.mg-play-state').textContent(),/Still panel/);
    assert.equal(await page.evaluate(()=>window.app.manga.player.wrapper.paused&&window.app.manga.player.videos.every(v=>v.paused)),true);
    await page.waitForFunction(()=>window.app.manga.pageIndex===2&&window.app.manga.player.running);
    await page.locator('.mg [data-action=stop]').click();await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(()=>window.app.manga.pageIndex),2,'Stop cancels automatic advancement');
    await page.locator('.mg [data-action=play]').click();await page.waitForFunction(()=>window.app.manga.pageIndex===3&&window.app.manga.player.running);
    await page.waitForFunction(()=>document.querySelector('.mg-status span').textContent==='Book finished.');
    assert.equal(await page.evaluate(()=>window.app.manga.player.intent),false);
    await page.locator('.mg [data-setting=stillSeconds]').fill('0');await page.locator('.mg [data-setting=stillSeconds]').dispatchEvent('change');
    await page.locator('.mg [data-setting=autoplay]').selectOption('page');
    await page.evaluate(()=>window.app.manga.page(0));await page.locator('.mg [data-action=play]').click();
    await page.waitForFunction(()=>window.app.manga.player.holding);await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(()=>window.app.manga.pageIndex),0);
    await page.locator('.mg [data-action=next-panel]').click();await page.waitForFunction(()=>window.app.manga.pageIndex===1&&window.app.manga.player.segment?.kind==='video');
    await page.locator('.mg [data-action=stop]').click();
    await page.locator('.mg [data-setting=stillSeconds]').fill('10');await page.locator('.mg [data-setting=stillSeconds]').dispatchEvent('change');
    await page.locator('.mg-close-details').click();
  }finally{
    await fs.writeFile(projectFile,original);await fs.rename(takes+'-saved',takes);
  }
  await page.evaluate(()=>window.app.manga.page(0));
  await page.locator('.mg [data-action=refresh]').click();await page.waitForFunction(()=>window.app.manga.book?.pages.length===2&&!window.app.manga.busy);
  console.log('PASS still reading: visible timer, pause/resume, saved time, still panels, consecutive still pages, Stop, manual mode and Next.');
}
