import assert from 'node:assert/strict';

export async function checkSeekBar(page,until){
  const seek=page.locator('.fc-player [data-field=seek]');
  const point=async fraction=>{
    const box=await seek.boundingBox();
    // The native thumb is 13px wide; the usable travel excludes half at each end.
    return {x:box.x+6.5+(box.width-13)*fraction,y:box.y+box.height/2};
  };
  const position=()=>page.evaluate(()=>window.app.composer.player.audio.currentTime);
  await seek.scrollIntoViewIfNeeded();
  await page.evaluate(async()=>{const c=window.app.composer;c.player.pause();await c.player.seek(4500);});
  await until(()=>!window.app.composer.player.aligning);
  const click=async fraction=>{
    const p=await point(fraction);await page.mouse.move(p.x,p.y);await page.mouse.down();
    // A real press spans several playback ticks, even when the song is paused.
    await page.waitForTimeout(150);await page.mouse.up();await until(()=>!window.app.composer.player.aligning);
  };
  await click(.2);assert.ok(Math.abs(await position()-1.2)<.12,'a paused click seeks backward instead of snapping back');
  await click(.7);assert.ok(Math.abs(await position()-4.2)<.12,'a paused click also seeks forward');
  const start=await point(.7),end=await point(.15);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});
  await page.waitForTimeout(150);assert.ok(Math.abs(Number(await seek.inputValue())-900)<120,'dragged position survives playback ticks');
  await page.mouse.up();await until(()=>!window.app.composer.player.aligning);
  assert.ok(Math.abs(await position()-.9)<.12);assert.equal(await page.evaluate(()=>window.app.composer.player.intent),false);
  // The same seek control is used for song-only and composed preview playback.
  for(const mode of ['song','preview']){
    await page.locator('[data-field=playback-mode]').selectOption(mode);
    if(mode==='preview'){await page.locator('[data-action=prepare]').click({force:true});await until(()=>!!window.app.composer.prepared&&!window.app.composer.preparing);}
    await page.evaluate(()=>{const c=window.app.composer;c.player.audio.loop=true;c.setPosition(0);});
    await page.locator('[data-action=play]').click({force:true});await until(()=>!window.app.composer.player.audio.paused);
    await click(.65);assert.ok(Math.abs(await position()-3.9)<.6,`${mode}: seek forward while playing`);
    await click(.1);assert.ok(await position()<1.3,`${mode}: seek backward while playing`);
    assert.ok(await page.evaluate(()=>window.app.composer.player.intent),`${mode}: preserve play intent`);
    await page.locator('[data-action=play]').click({force:true});
  }
  // Ruler seeking must still work in either direction after transport scrubbing.
  await page.locator('[data-action=zoom-fit]').click({force:true});
  const ruler=page.locator('.fc-ruler');await ruler.scrollIntoViewIfNeeded();const rect=await ruler.boundingBox();
  await ruler.click({position:{x:rect.width*.75,y:12},force:true});await until(()=>!window.app.composer.player.aligning);
  assert.ok(Math.abs(await position()-4.5)<.08);
  await ruler.click({position:{x:rect.width*.2,y:12},force:true});await until(()=>!window.app.composer.player.aligning);
  assert.ok(Math.abs(await position()-1.2)<.08);
  await page.evaluate(async()=>{const c=window.app.composer;c.player.audio.loop=false;c.player.pause();await c.player.seek(0);});
  console.log('PASS: real seek-bar clicks and held drags backward/forward, paused and playing song/preview, and backward/forward ruler seeks.');
}
