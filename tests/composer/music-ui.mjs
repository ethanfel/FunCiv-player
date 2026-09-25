import assert from 'node:assert/strict';

export async function checkMusicEditor(app,page,until,beatFile,screenshot){
  await page.evaluate(()=>{
    const c=window.app.composer;c.beforeMusicEditor={session:c.session,history:c.history,dirty:c.dirty,selected:c.selected};
    c.player.pause();c.session=structuredClone(c.session);c.session.id=crypto.randomUUID();c.session.name='Music editor test';c.renderEditor();
    window.musicMainSource=c.player.audio.src;
  });
  await app.evaluate(({dialog},file)=>{
    globalThis.musicPreviousDialog=dialog.showOpenDialog;
    dialog.showOpenDialog=async options=>options.title==='Choose drums / beat track'?{canceled:false,filePaths:[file]}:globalThis.musicPreviousDialog(options);
  },beatFile);
  try{
    await page.locator('#fc-music-tab').click({force:true});assert.equal(await page.locator('#fc-music-tab').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('.fc-library').isVisible(),false);assert.equal(await page.locator('.fc-music-editor').isVisible(),true);
    await page.locator('[data-music-action=import]').click();
    await until(()=>!!window.app.composer.session.music?.analysis&&!window.app.composer.busy);
    const imported=await page.evaluate(()=>{const c=window.app.composer;return {beats:c.catalog.beats.length,songs:c.catalog.songs.length,name:c.session.music.beat_track.name,hits:c.session.music.analysis.onsets.length,src:c.player.audio.src,original:window.musicMainSource};});
    assert.equal(imported.beats,1);assert.equal(imported.songs,1);assert.equal(imported.name,'Drums.wav');assert.ok(imported.hits>=8);assert.equal(imported.src,imported.original);
    const beatId=await page.locator('[data-music-source-select]').inputValue();
    await page.locator('[data-music-source-select]').selectOption('');
    await until(()=>!window.app.composer.session.music.beat_track);
    await page.locator('[data-music-source-select]').selectOption(beatId);
    await until(()=>!!window.app.composer.session.music.analysis&&!window.app.composer.busy);
    await page.locator('[data-music-setting=rhythm]').selectOption('original');
    await page.locator('.fc-music-catalogue summary').click();await page.locator('[data-music-action=pattern][data-shape="Triangle"]').click();
    await page.locator('[data-music-setting=followEnergy]').uncheck();
    await page.locator('[data-music-action=generate]').click();
    const first=await page.evaluate(()=>window.app.composer.musicEditor.draft.events.map(e=>e.at));assert.ok(first.length>=8);
    assert.equal(await page.evaluate(()=>window.app.composer.session.music.blocks.length),0,'preview has not changed the compiled script');
    await page.locator('[data-music-offset]').fill('120');await page.locator('[data-music-offset]').press('Tab');
    await page.locator('[data-music-action=generate]').click();
    const shifted=await page.evaluate(()=>window.app.composer.musicEditor.draft.events.map(e=>e.at));
    assert.deepEqual(shifted,first.map(at=>at+120).filter(at=>at<6000));
    await page.locator('[data-music-action=listen]').click();await until(()=>!window.app.composer.musicEditor.audio.paused);
    assert.equal(await page.evaluate(()=>window.app.composer.player.audio.paused),true);await page.locator('[data-music-action=stop-audition]').click();
    await page.locator('[data-music-action=apply]').click();
    assert.equal(await page.evaluate(()=>window.app.composer.session.music.blocks.length),1);
    assert.equal(await page.locator('[data-music-action=apply]').textContent(),'Apply to arrangement');
    await page.locator('[data-music-action=arrangement]').click();
    assert.equal(await page.locator('.fc-saved-beats').isVisible(),true,'saved beats immediately appear on the main timeline');
    await page.locator('#fc-music-tab').click({force:true});

    await page.locator('[data-music-action=undo]').click();assert.equal(await page.evaluate(()=>window.app.composer.session.music.blocks.length),0);
    await page.locator('[data-music-action=redo]').click();assert.equal(await page.evaluate(()=>window.app.composer.session.music.blocks.length),1);
    // A replacement inside a saved block must retain both untouched ends.
    for(const [bound,time] of [['start','1'],['end','3']]){await page.locator(`[data-music-bound=${bound}]`).fill(time);await page.locator(`[data-music-bound=${bound}]`).press('Tab');}
    await page.locator('[data-music-action=pattern][data-shape="Double Tap"]').click();
    await page.locator('[data-music-action=generate]').click();await page.locator('[data-music-action=apply]').click();
    assert.deepEqual(await page.evaluate(()=>window.app.composer.session.music.blocks.map(b=>[b.start,b.end])),[[0,1000],[1000,3000],[3000,6000]]);
    // Exercise real pointer selection, handles, zoom anchoring and seeks.
    await page.locator('[data-music-action=fit-range]').click();
    const canvas=page.locator('.fc-music-canvas');await canvas.scrollIntoViewIfNeeded();
    const box=await canvas.boundingBox();
    await page.keyboard.down('Shift');await page.mouse.move(box.x+box.width*.25,box.y+115);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+115,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
    const before=await page.evaluate(()=>({start:window.app.composer.musicEditor.start,end:window.app.composer.musicEditor.end}));
    const handle=await page.locator('[data-music-edge=end]').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x-50,handle.y+handle.height/2,{steps:4});await page.mouse.up();
    assert.ok(await page.evaluate(before=>window.app.composer.musicEditor.end<before.end&&window.app.composer.musicEditor.start===before.start,before));
    await canvas.click({position:{x:box.width*.2,y:50}});await until(()=>!window.app.composer.player.aligning);
    const seeked=await page.evaluate(()=>window.app.composer.player.audio.currentTime);assert.ok(seeked>0&&seeked<3);
    await page.locator('[data-music-action=whole]').click();await page.locator('[data-music-action=fit]').click();
    await page.locator('[data-action=save]').click({force:true});await until(()=>!window.app.composer.dirty);
    assert.ok(await page.evaluate(async()=>{const c=window.app.composer,saved=await c.ipc('load',{id:c.session.id});return JSON.stringify(saved.music)===JSON.stringify(c.session.music);}), 'import, analysis, offsets and blocks persist');
    // Compile the authored curve into a real prepared session without changing cuts.
    await page.evaluate(()=>{const c=window.app.composer;c.edit(s=>{s.blend_ms=0;for(const section of s.sections){section.motion='song';section.strength=100;}},{keepPlacements:true});});
    await page.locator('[data-action=prepare]').click({force:true});await until(()=>!!window.app.composer.prepared&&!window.app.composer.preparing);
    assert.ok(await page.evaluate(async()=>{const c=window.app.composer,{evaluate}=await import('./../vendor/motion-studio/curve.mjs');return c.session.music.blocks.every(b=>Math.abs(evaluate(c.prepared.snapshot.scripts.L0.actions,(b.start+b.end)/2)-evaluate(b.actions,(b.start+b.end)/2))<=1); }));
    if(screenshot){
      await page.locator('.fc-music-catalogue summary').click();await page.locator('.fc-music-heading').scrollIntoViewIfNeeded();await page.screenshot({path:screenshot});
      await page.locator('.fc-music-range-tools').scrollIntoViewIfNeeded();await page.screenshot({path:screenshot.replace('.png','-timeline.png')});
    }
    await page.setViewportSize({width:800,height:1000});
    assert.ok(await page.locator('.fc-music-editor').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'editor fits a narrow viewport');
    await page.setViewportSize({width:1500,height:1080});
    await page.locator('#fc-arrangement-tab').click({force:true});assert.equal(await page.locator('.fc-library').isVisible(),true);
    console.log('PASS: dedicated beat editor, native drum import/analysis, main audio preserved, measured peaks and offset, catalogue, audition, saved range replacement, undo/redo, pointer editing/zoom, persistence and compiled preview.');
  }finally{
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.musicPreviousDialog;delete globalThis.musicPreviousDialog;});
    await page.evaluate(()=>{const c=window.app.composer;c.musicEditor.open(false);c.player.pause();Object.assign(c,c.beforeMusicEditor);delete c.beforeMusicEditor;c.invalidate({pause:true});c.setPosition(0);c.renderEditor();});
    await page.locator('[data-action=prepare]').click({force:true});await until(()=>!!window.app.composer.prepared&&!window.app.composer.preparing);
  }
}
