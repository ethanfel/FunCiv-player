import assert from 'node:assert/strict';

async function dragBoundary(page,delta,{alt=false,release=true}={}){
  const rect=await page.locator('.fc-section-handle').first().boundingBox();
  const scale=await page.evaluate(()=>document.querySelector('.fc-section-strip').getBoundingClientRect().width/window.app.composer.session.song.duration_ms);
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  if(alt)await page.keyboard.down('Alt');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+delta*scale,y,{steps:5});
  if(release)await page.mouse.up();
  if(alt)await page.keyboard.up('Alt');
}
const state=page=>page.evaluate(()=>JSON.stringify(window.app.composer.session));
const end=page=>page.evaluate(()=>window.app.composer.session.sections[0].end_ms);
const undo=page=>page.locator('[data-action=undo]').dispatchEvent('click');

export async function checkSectionHandles(page){
  const recipe=await state(page),history=await page.evaluate(()=>window.app.composer.history.past.length);
  assert.equal(await page.locator('.fc-section-handle').count(),5);
  assert.ok(await page.locator('.fc-section-handle').first().evaluate(el=>el.getBoundingClientRect().width>=14&&getComputedStyle(el).cursor==='ew-resize'));
  await page.locator('[data-field=snap-audio]').uncheck({force:true});
  await page.locator('.fc-timeline-viewport').evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.locator('[data-field=timeline-zoom]').selectOption('4');
  await page.locator('.fc-timeline-viewport').evaluate(el=>el.scrollLeft=el.clientWidth/4);
  await page.locator('.fc-section-handle').first().click();
  assert.equal(await state(page),recipe,'clicking a handle without moving does not edit the recipe');
  await dragBoundary(page,250);
  assert.ok(Math.abs(await end(page)-1250)<=2,'drag uses song time at nonzero zoom and scroll');
  assert.ok(await page.evaluate(()=>{const s=window.app.composer.session.sections;return s[0].end_ms===s[1].start_ms&&s[1].end_ms===2000&&s.at(-1).end_ms===6000;}));
  assert.equal(await page.evaluate(()=>window.app.composer.history.past.length),history+1,'one undo entry per drag');
  await undo(page);assert.equal(await state(page),recipe);
  await page.locator('[data-action=redo]').dispatchEvent('click');assert.ok(Math.abs(await end(page)-1250)<=2);await undo(page);
  await dragBoundary(page,200,{release:false});
  assert.ok(await page.locator('.fc-section-guide').isVisible());
  assert.ok((await page.locator('.fc-section-guide output').textContent()).startsWith('0:01.2'));
  await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await state(page),recipe,'Escape cancels all pending timing changes');
  await dragBoundary(page,200,{release:false});
  await page.evaluate(()=>{const c=window.app.composer;c.root.dispatchEvent(new PointerEvent('pointercancel',{pointerId:c.sectionEditor.drag.pointer,bubbles:true}));});
  await page.mouse.up();assert.equal(await state(page),recipe,'pointer cancellation also restores the recipe');
  await page.locator('.fc-section-handle').first().focus();await page.keyboard.press('ArrowRight');assert.equal(await end(page),1100);await undo(page);
  await page.locator('.fc-section-handle').first().focus();await page.keyboard.press('Shift+ArrowRight');assert.equal(await end(page),1900,'keyboard moves clamp to a 100 ms neighboring section');await undo(page);
  const analysis=await page.evaluate(()=>{const c=window.app.composer,previous=c.session.analysis;c.session.analysis={...(previous||{}),beats:[{at:1250}],onsets:[]};return previous;});
  await page.locator('[data-field=snap-audio]').check({force:true});
  await dragBoundary(page,200);assert.equal(await end(page),1250,'drag snaps to the detected beat');await undo(page);
  await dragBoundary(page,200,{alt:true});assert.ok(Math.abs(await end(page)-1200)<=2,'Alt bypasses snapping');await undo(page);
  await page.evaluate(analysis=>{window.app.composer.session.analysis=analysis;},analysis);
  await page.evaluate(()=>{const c=window.app.composer;c.session.sections[1].locked=true;c.renderEditor();});
  assert.ok(await page.locator('.fc-section-handle').first().isDisabled());
  await page.evaluate(()=>{const c=window.app.composer;c.session.sections[1].locked=false;c.renderEditor();});
  assert.equal(await state(page),recipe);assert.equal(await page.evaluate(()=>window.app.composer.history.past.length),history);
  await page.locator('[data-action=zoom-fit]').dispatchEvent('click');
  console.log('PASS: draggable song-section handles, zoom/scroll geometry, shared bounds, undo/redo, Escape/cancel, keyboard limits, snapping and locks.');
}

export async function checkPopulatedSectionHandle(page){
  const recipe=await state(page);
  const original=await page.evaluate(()=>{const s=window.app.composer.session;return s.placements.find(p=>p.start_ms===s.sections[1].start_ms);});
  await page.locator('[data-field=snap-audio]').uncheck({force:true});
  await page.locator('.fc-timeline-viewport').evaluate(el=>el.scrollIntoView({block:'center'}));
  await dragBoundary(page,250);
  assert.ok(Math.abs(await end(page)-1250)<=4);
  assert.ok(await page.evaluate(original=>{
    const s=window.app.composer.session,p=s.placements.find(p=>p.start_ms===s.sections[1].start_ms);
    return Math.abs(p.source_in_ms-(original.source_in_ms+250*original.rate))<=4&&s.placements.every(p=>p.clip_id)&&s.placements.some(p=>p.start_ms===1000&&p.end_ms===s.sections[0].end_ms);
  },original),'moving a populated boundary keeps clips and source continuity');
  await undo(page);assert.equal(await state(page),recipe,'undo restores all original placements and trims');
  await page.locator('[data-field=snap-audio]').check({force:true});
}
