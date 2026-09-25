import assert from 'node:assert/strict';
export async function checkTimedBubbles(page){
  const original=await page.evaluate(()=>({src:window.app.manga.player.video.currentSrc,scripts:JSON.stringify(window.app.manga.run.scripts)}));
  const pixels=()=>page.locator('.mg-bubbles').evaluate(canvas=>{const ctx=canvas.getContext('2d');return {hidden:canvas.hidden,left:ctx.getImageData(60,40,1,1).data[3],right:ctx.getImageData(250,40,1,1).data[3],rightEdge:ctx.getImageData(201,40,1,1).data[3]};});
  const seek=async ms=>{await page.evaluate(async at=>{const c=window.app.manga;c.player.pause();await c.player.seekPanel(at);},ms);return pixels();};
  assert.equal((await seek(200)).hidden,true,'no premature bubbles');
  let frame=await seek(375);assert.ok(Math.abs(frame.left-128)<=2,JSON.stringify(frame));assert.equal(frame.right,0);
  frame=await seek(750);assert.equal(frame.left,255);assert.equal(frame.right,0);
  assert.equal((await seek(1000)).hidden,true,'first interval ends exactly as the next entrance starts at zero opacity');
  frame=await seek(1125);assert.ok(Math.abs(frame.right-128)<=2,JSON.stringify(frame));assert.equal(frame.left,0);assert.equal(frame.rightEdge,0,'pop scales around the bubble bounds, not the whole frame');
  frame=await seek(1500);assert.equal(frame.right,255);assert.equal(frame.left,0,'repaired second layer replaces first bubble');
  assert.equal((await seek(750)).left,255,'backward seek restores the earlier bubble');
  await page.locator('.mg [data-field=bubbles]').uncheck();assert.equal(await page.locator('.mg-bubbles').isVisible(),false);
  await page.locator('.mg [data-field=bubbles]').check();assert.equal((await pixels()).left,255);
  const ignore=page.locator('.mg [data-setting=ignoreBubbleTiming]');
  assert.equal(await ignore.isChecked(),false,'Animator timing is the default');
  await seek(200);
  await page.evaluate(async()=>{const c=window.app.manga;await c.player.play();c.bubbleToggleProbe={run:c.run,video:c.player.video,viewGeneration:c.generation,playerGeneration:c.player.generation,deviceGeneration:c.devices.generation};});
  await ignore.check();
  const live=await page.evaluate(()=>{const c=window.app.manga,p=c.bubbleToggleProbe,result={playing:c.player.intent&&!c.player.video.paused,sameRun:c.run===p.run,sameVideo:c.player.video===p.video,sameViewGeneration:c.generation===p.viewGeneration,samePlayerGeneration:c.player.generation===p.playerGeneration,sameDeviceGeneration:c.devices.generation===p.deviceGeneration};delete c.bubbleToggleProbe;c.player.pause();return result;});
  assert.ok(Object.values(live).every(Boolean),`timing preference must not interrupt playback or device preparation: ${JSON.stringify(live)}`);
  for(const at of [200,375,1125,1750]){frame=await seek(at);assert.equal(frame.hidden,false);assert.equal(frame.left,255,'earlier bubble stays fully visible');assert.equal(frame.right,255,'later bubble is immediately visible');assert.equal(frame.rightEdge,255,'ignore timing also skips the pop transition');}
  await page.locator('.mg [data-field=bubbles]').uncheck();assert.equal(await page.locator('.mg-bubbles').isVisible(),false,'Bubbles off takes precedence over ignore timing');
  await page.locator('.mg [data-field=bubbles]').check();frame=await pixels();assert.equal(frame.left,255);assert.equal(frame.right,255);
  await seek(200);await ignore.uncheck();assert.equal((await pixels()).hidden,true,'restoring timing immediately hides layers outside their intervals');
  assert.equal(await page.evaluate(()=>window.app.manga.player.video.currentSrc),original.src,'toggling only composites lettering');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.app.manga.run.scripts)),original.scripts,'bubble timing never changes motion');
  await page.evaluate(async()=>{
    const c=window.app.manga;c.beforeBubbleRun=c.run;
    const run=await c.ipc('prepare',{id:c.book.id,page:c.pageIndex,settings:{...c.settings,mode:'loop',extraSeconds:1},overrides:c.overrides});
    c.run=run;await c.player.load(run,c.panelId);await c.player.select(1,375,false);
  });
  frame=await pixels();assert.ok(Math.abs(frame.left-128)<=2,JSON.stringify(frame));assert.equal(frame.right,0,'loop uses local video time');
  await page.evaluate(async()=>{
    const c=window.app.manga,run=await c.ipc('prepare',{id:c.book.id,page:c.pageIndex,settings:{...c.settings,mode:'extend',extraSeconds:1},overrides:c.overrides});
    c.run=run;await c.player.load(run,c.panelId);await c.player.select(1,375,false);
  });
  assert.equal(await page.evaluate(()=>window.app.manga.player.segment.kind),'extension');
  frame=await pixels();assert.equal(frame.right,255);assert.equal(frame.left,0,'extension retains lettering at the held final video frame');
  await page.evaluate(async()=>{const c=window.app.manga;c.run=c.beforeBubbleRun;delete c.beforeBubbleRun;await c.player.load(c.run,c.run.segments[0].panelId);await c.player.select(c.run.segments.findIndex(s=>s.panelId!==c.run.segments[0].panelId),500,false);});
  assert.equal((await pixels()).left,255,'older untimed overlays still render');
  await page.evaluate(async()=>{const c=window.app.manga;await c.player.load(c.run,c.run.segments[0].panelId);await c.player.seekPanel(300);});
  console.log('PASS Manga bubbles: frame-aligned intervals, fade/pop pixels, repaired layers, disabled tracks, backward seeking, live visibility and ignore-timing toggles, loop timing and frozen-frame motion extension.');
}
