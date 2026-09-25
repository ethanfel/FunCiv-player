import assert from 'node:assert/strict';

export async function checkPrecacheTransition(page){
  await page.waitForFunction(()=>{const c=window.app.manga;return c.pageIndex===0&&c.ahead?.run&&c.player.warmTask?.video.readyState>=2;});
  assert.equal(await page.evaluate(()=>{const p=window.app.manga.player;return p.videos.every(v=>v.paused)&&p.warmTask.video.hidden;}),true);
  await page.locator('.mg [data-action=play]').click();await page.waitForFunction(()=>window.app.manga.player.running);
  await page.evaluate(()=>{
    const c=window.app.manga,p=c.player;window.mangaWarmVideo=p.warmTask.video;window.mangaWarmLoads=0;
    const load=window.mangaWarmVideo.load.bind(window.mangaWarmVideo);window.mangaSavedLoad=load;window.mangaWarmVideo.load=()=>{window.mangaWarmLoads++;return load();};
    const ready=p.ready.bind(p);window.mangaSavedReady=ready;p.ready=async(...args)=>{if(args[0]===window.mangaWarmVideo&&typeof args[3]==='number')await new Promise(r=>setTimeout(r,180));return ready(...args);};
    window.mangaTransitionFrames=[];window.mangaObserveTransition=true;
    const watch=()=>{if(!window.mangaObserveTransition)return;window.mangaTransitionFrames.push({page:c.pageIndex,wholePage:!c.root.querySelector('.mg-paper-area').hidden,curtain:!!c.root.querySelector('.mg-transition'),running:p.running});requestAnimationFrame(watch);};watch();
  });
  await page.locator('.mg [data-action=next-panel]').click();
  await page.waitForFunction(()=>window.app.manga.pageIndex===1&&window.app.manga.player.running);
  await page.waitForFunction(()=>!document.querySelector('.mg-transition'));
  const observed=await page.evaluate(()=>{window.mangaObserveTransition=false;return {frames:window.mangaTransitionFrames,reused:window.app.manga.player.video===window.mangaWarmVideo,loads:window.mangaWarmLoads};});
  assert.equal(observed.reused,true,'the predecoded next-page video becomes active');assert.equal(observed.loads,0,'there is no reload on page handoff');
  assert.ok(observed.frames.some(f=>f.curtain&&!f.running),'outgoing image is held during a delayed handoff');
  assert.equal(observed.frames.some(f=>f.page===1&&f.wholePage),false,'page 2 never flashes as a full page before the video');
  await page.evaluate(()=>{window.app.manga.player.ready=window.mangaSavedReady;window.mangaWarmVideo.load=window.mangaSavedLoad;});
  await page.locator('.mg [data-action=stop]').click();
  await page.evaluate(()=>window.app.manga.page(0));
  console.log('PASS page transition: next video predecoded and silent, reused without loading, outgoing image held, no full-page flash.');
}
