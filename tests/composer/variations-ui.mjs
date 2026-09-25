import assert from 'node:assert/strict';

export async function checkScopedVariations(page,until){
  await page.evaluate(async()=>{
    const c=window.app.composer,{createSession,planRegions,arrange,History}=await import('./../packages/composer-core/index.mjs');
    c.variationsOriginal={session:c.session,history:c.history,dirty:c.dirty,selected:c.selected,selectedPlacement:c.selectedPlacement,inspectorMode:c.inspectorMode};
    c.invalidate({pause:true});if(c.preparationTask)await c.preparationTask;
    let session=createSession(c.session.song,2);session.repeat_policy='cycle';
    for(const section of session.sections){section.motion='hold';session=planRegions(session,section.id,[section.start_ms+1500]);}
    c.session=arrange(session,c.catalog.clips);c.history=new History();c.selected=0;c.position=0;c.loadSongPlayback();c.renderEditor();
    await c.prepare();c.player.audio.loop=true;await c.player.play();
    c.regionEditor.select(c.session.placements[0].id);
    c.variationPauses=0;c.variationPauseListener=()=>c.variationPauses++;c.player.audio.addEventListener('pause',c.variationPauseListener);
  });
  const snapshot=()=>page.evaluate(()=>structuredClone(window.app.composer.session));
  try{
    const before=await snapshot(),original=before.placements[0];
    await page.locator('[data-action=replace-clip]').click({force:true});
    await until(()=>{const c=window.app.composer;return !!c.prepared&&!c.preparing&&c.player.snapshot===c.prepared.snapshot;});
    const replaced=await snapshot(),replacement=replaced.placements.find(p=>p.id===original.id);
    assert.notEqual(replacement.clip_id,original.clip_id);assert.equal(replacement.locked,true);
    assert.deepEqual([replacement.start_ms,replacement.end_ms,replacement.rate],[original.start_ms,original.end_ms,original.rate]);
    assert.deepEqual(replaced.placements.filter(p=>p.id!==original.id),before.placements.filter(p=>p.id!==original.id));
    await page.locator('[data-action=undo]').click({force:true});assert.deepEqual((await snapshot()).placements,before.placements);
    await page.locator('[data-action=redo]').click({force:true});assert.deepEqual((await snapshot()).placements,replaced.placements);
    await page.locator('[data-action=remake-section]').click({force:true});
    await until(()=>{const c=window.app.composer;return !!c.prepared&&!c.preparing&&c.player.snapshot===c.prepared.snapshot;});
    const remade=await snapshot(),id=original.section_id;
    assert.deepEqual(remade.placements.filter(p=>p.section_id!==id),replaced.placements.filter(p=>p.section_id!==id));
    assert.deepEqual(remade.placements.find(p=>p.id===original.id),replacement,'kept replacement survives remaking its section');
    assert.notDeepEqual(remade.placements.filter(p=>p.section_id===id),replaced.placements.filter(p=>p.section_id===id));
    assert.deepEqual(remade.placements.map(p=>[p.start_ms,p.end_ms]),replaced.placements.map(p=>[p.start_ms,p.end_ms]),'manual cuts stay fixed');
    assert.ok(await page.evaluate(()=>{const c=window.app.composer;return !c.songOnly()&&c.player.intent&&!c.player.audio.paused&&c.variationPauses===0;}),'both actions preserve preview mode and continuous song playback');
    await page.locator('[data-action=undo]').click({force:true});assert.deepEqual((await snapshot()).placements,replaced.placements);
    await page.evaluate(()=>{const c=window.app.composer;c.session.sections[0].locked=true;c.renderEditor();});
    assert.equal(await page.locator('[data-action=replace-clip]').isDisabled(),true);
    assert.equal(await page.locator('[data-action=remake-section]').isDisabled(),true);
  }finally{
    await page.evaluate(async()=>{
      const c=window.app.composer;c.player.audio.removeEventListener('pause',c.variationPauseListener);c.player.audio.loop=false;
      c.invalidate({pause:true});if(c.preparationTask)await c.preparationTask;
      Object.assign(c,c.variationsOriginal);delete c.variationsOriginal;delete c.variationPauses;delete c.variationPauseListener;
      c.position=0;c.loadSongPlayback();c.renderEditor();await c.prepare();
    });
  }
  console.log('PASS: Replace clip and Remake section preserve spans, neighboring sections, kept clips, Undo/Redo, selected playback mode and uninterrupted audio.');
}
