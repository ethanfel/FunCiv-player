import assert from 'node:assert/strict';

export async function checkAutomaticPacing(page,until){
  await page.evaluate(async()=>{
    const c=window.app.composer,{createSession}=await import('./../packages/composer-core/index.mjs');
    c.pacingOriginal={session:c.session,catalog:c.catalog,history:c.history,dirty:c.dirty,selected:c.selected};
    c.session=createSession({...c.session.song,duration_ms:64000},2);c.selected=0;
    c.catalog={...c.catalog,clips:Array.from({length:9},(_,i)=>({id:`paced-${i}`,name:`Pacing ${i}`,path:`/synthetic/${i}.mp4`,duration_ms:i===8?500:60000,available:true,script_ready:true,quality:5,categories:['A']}))};
    c.renderEditor();
  });
  assert.equal(await page.locator('[data-field=auto-min]').inputValue(),'4');
  assert.equal(await page.locator('[data-field=auto-max]').inputValue(),'12');
  await page.locator('[data-action=assemble]').click({force:true});
  await until(()=>window.app.composer.session.placements.length===6);
  assert.ok(await page.evaluate(()=>{
    const s=window.app.composer.session;return new Set(s.placements.map(p=>p.clip_id)).size===6&&s.sections.every(section=>s.placements.filter(p=>p.section_id===section.id).length>=2)&&s.placements.every(p=>p.end_ms-p.start_ms>=4000&&p.end_ms-p.start_ms<=12000);
  }));
  for(const [field,value] of [['auto-min','5'],['auto-max','10']]){
    await page.locator(`[data-field=${field}]`).fill(value);await page.locator(`[data-field=${field}]`).dispatchEvent('change');
  }
  await page.locator('[data-action=assemble]').click({force:true});
  await until(()=>window.app.composer.session.placements.length===8);
  assert.ok(await page.evaluate(()=>window.app.composer.session.placements.every(p=>p.end_ms-p.start_ms>=5000&&p.end_ms-p.start_ms<=10000)));
  await page.evaluate(()=>{const c=window.app.composer;Object.assign(c,c.pacingOriginal);delete c.pacingOriginal;c.renderEditor();});
  console.log('PASS: automatic 4–12s defaults, multiple distinct sources per section, no flashes, and editable range.');
}

export async function checkEditingPlayback(page,until){
  await page.evaluate(()=>{const c=window.app.composer;c.editingOriginal={session:c.session,history:c.history,dirty:c.dirty,selected:c.selected};c.player.audio.loop=true;});
  await page.locator('[data-field=playback-mode]').selectOption('song');
  await page.evaluate(()=>{const c=window.app.composer;c.setPosition(0);c.root.querySelector('.fc-section-strip [data-action=select-section]').focus();});
  await page.keyboard.press('Space');await until(()=>window.app.composer.player.intent&&!window.app.composer.player.audio.paused);
  await page.evaluate(()=>{
    const c=window.app.composer;c.testPauseCount=0;c.testPauseListener=()=>c.testPauseCount++;c.player.audio.addEventListener('pause',c.testPauseListener);
  });
  const originalName=await page.locator('[data-field=name]').inputValue();
  await page.locator('[data-field=name]').fill(originalName+' edited');await page.locator('[data-field=name]').dispatchEvent('change');
  await page.locator('.fc-section-handle').first().focus();await page.keyboard.press('ArrowRight');
  await page.locator('[data-action=undo]').click({force:true});
  assert.ok(await page.evaluate(()=>{const c=window.app.composer;return c.player.intent&&!c.player.audio.paused&&c.testPauseCount===0;}),'text edits, boundary edits and undo do not pause the song');
  // Text input retains ordinary Space; after a re-render, body focus also works.
  await page.locator('[data-field=search]').focus();await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>window.app.composer.player.intent),true);
  await page.locator('[data-field=search]').fill('');
  await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('Space');
  assert.equal(await page.evaluate(()=>window.app.composer.player.intent),false);
  await page.locator('.fc-section-handle').first().focus();await page.keyboard.press('Space');
  await until(()=>!window.app.composer.player.audio.paused);
  await page.keyboard.down('Space');await page.keyboard.down('Space');await page.keyboard.up('Space');
  assert.equal(await page.evaluate(()=>window.app.composer.player.intent),false,'holding Space toggles only once');
  await page.evaluate(()=>{const c=window.app.composer;c.player.audio.removeEventListener('pause',c.testPauseListener);c.setPosition(0);});
  await page.locator('[data-action=prepare]').click({force:true});await until(()=>!!window.app.composer.prepared&&!window.app.composer.preparing);
  await page.locator('[data-action=play]').click({force:true});await until(()=>!window.app.composer.player.audio.paused);
  const before=await page.evaluate(()=>{
    const c=window.app.composer,time=c.player.audio.currentTime,src=c.player.audio.src,input=c.root.querySelector('[data-field=strength]');
    c.testPauseCount=0;c.player.audio.addEventListener('pause',c.testPauseListener);input.value='80';input.dispatchEvent(new Event('change',{bubbles:true}));
    return {time,src};
  });
  assert.ok(await page.evaluate(before=>{const c=window.app.composer;return c.player.intent&&!c.player.audio.paused&&c.testPauseCount===0&&c.player.audio.src===before.src&&c.player.audio.currentTime>=before.time&&!c.prepared&&!c.devices.active&&!c.songOnly();},before),'editing an active preview preserves the song clock, playback mode and releases stale motion');
  await until(()=>{const c=window.app.composer;return !!c.prepared&&!c.preparing&&c.player.current&&c.player.videos.some(v=>!v.hidden&&!v.paused);});
  assert.ok(await page.evaluate(()=>{const c=window.app.composer;return c.testPauseCount===0&&!c.songOnly()&&!c.player.audio.paused;}),'preview automatically rejoins the playing song without an audio pause');
  const trim=await page.evaluate(()=>{
    const c=window.app.composer,p=c.session.placements[0];c.regionEditor.select(p.id);
    return {id:p.id,offset:p.source_in_ms};
  });
  const rail=await page.locator('.fc-source-rail').boundingBox(),handle=await page.locator('[data-source-drag]').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+(trim.offset>500?-1:1)*rail.width/8,handle.y+handle.height/2,{steps:5});await page.mouse.up();
  assert.notEqual(await page.evaluate(id=>window.app.composer.session.placements.find(p=>p.id===id).source_in_ms,trim.id),trim.offset,'the source portion was moved');
  await until(()=>{const c=window.app.composer;return !!c.prepared&&!c.preparing&&c.prepared.snapshot.placements.every(p=>p.source_in_ms===c.session.placements.find(region=>region.id===p.id).source_in_ms);});
  assert.ok(await page.evaluate(()=>{const c=window.app.composer;return !c.songOnly()&&c.player.intent&&!c.player.audio.paused&&c.testPauseCount===0;}),'source window dragging rebuilds preview while the selected mode and audio continue');
  await page.evaluate(()=>{
    const c=window.app.composer;c.player.audio.removeEventListener('pause',c.testPauseListener);c.player.audio.loop=false;c.player.pause();
    Object.assign(c,c.editingOriginal);delete c.editingOriginal;delete c.testPauseListener;delete c.testPauseCount;c.setPosition(0);c.renderEditor();
  });
  await page.locator('[data-action=prepare]').click({force:true});await until(()=>!!window.app.composer.prepared&&!window.app.composer.preparing);
  console.log('PASS: Space on timeline/body/handles, typing and held-key guards, uninterrupted edits/undo, stable playback mode and automatic preview refresh after source drags.');
}
