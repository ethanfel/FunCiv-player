import assert from 'node:assert/strict';

export async function checkSourceFilters(page,until,screenshot){
  await page.evaluate(async()=>{
    const c=window.app.composer,{createSession,planRegions,arrange,History}=await import('./../packages/composer-core/index.mjs');
    c.beforeSources={session:c.session,catalog:c.catalog,history:c.history,dirty:c.dirty,selected:c.selected,selectedPlacement:c.selectedPlacement,inspectorMode:c.inspectorMode,librarySourceFilters:c.librarySourceFilters};
    c.invalidate({pause:true});if(c.preparationTask)await c.preparationTask;
    c.catalog=structuredClone(c.catalog);c.catalog.clips=c.catalog.clips.filter(c=>['A.mp4','B.mp4','C.mp4'].includes(c.name));
    const a=c.catalog.clips.find(c=>c.name==='A.mp4'),b=c.catalog.clips.find(c=>c.name==='B.mp4');
    c.catalog.clips.push({...structuredClone(a),id:'source-draft-alias',origin:'dataset',review_status:'draft',creator_username:'Alice_AI',post_id:'456',
      civitai_metadata:{base_model:'Model One',width:1080,height:1920,content_rating:'Mature',created_at:'2026-09-24T00:00:00Z',stats:{likeCount:10,heartCount:2}}});
    b.creator_username='Bob';b.civitai_metadata={base_model:'Model Two',width:1920,height:1080,content_rating:'PG'};
    for(let i=0;i<45;i++)c.catalog.clips.push({id:`source-extra-${i}`,name:`Extra creator ${i}`,origin:'dataset',review_status:'approved',quality:0,available:false,creator_username:`ExampleArtist${String(i).padStart(2,'0')}`,civitai_metadata:{base_model:'Model One',width:1080,height:1920}});
    let s=createSession(c.session.song,2);s.min_rating=4;s.repeat_policy='cycle';
    for(const section of s.sections){section.motion='hold';s=planRegions(s,section.id,[section.start_ms+1500]);}
    c.session=arrange(s,c.catalog.clips);c.history=new History();c.selected=0;c.position=0;c.loadSongPlayback();c.librarySourceFilters=undefined;
    c.root.querySelector('[data-field=search]').value='';c.root.querySelector('[data-field=library-view]').value='all';c.renderEditor();
    await c.prepare();c.sourcePrepared=c.prepared;c.player.audio.loop=true;await c.player.play();
    c.sourcePauses=0;c.sourcePauseListener=()=>c.sourcePauses++;c.player.audio.addEventListener('pause',c.sourcePauseListener);
  });
  const dialog=page.locator('.fc-source-dialog');
  const open=scope=>page.locator(scope==='section'?'.fc-selection-bar [data-action=section-sources]':`[data-action=${scope}-sources]`).click({force:true});
  const choice=(field,value)=>dialog.locator(`[data-source-field=${field}][value="${value}"]`);
  const apply=async()=>{await dialog.locator('[value=apply]').click();await until(()=>!document.querySelector('.fc-source-dialog'));};
  const prefs=()=>page.evaluate(()=>{const c=window.app.composer;return {session:c.session.source_filters,section:c.session.sections[0].source_filters};});
  try{
    const before=await page.evaluate(()=>structuredClone(window.app.composer.session));
    await open('library');await dialog.locator('[name=creator-search]').fill('ALICE');
    assert.equal(await dialog.locator('.fc-source-creator-list .fc-source-choice').count(),1);
    assert.equal(await dialog.locator('.fc-source-creator-list small').textContent(),'1','HF alias and local file count once');
    await choice('creators','alice_ai').check();await choice('orientations','portrait').check();await dialog.locator('[value=cancel]').click();
    assert.equal(await page.locator('.fc-clip').count(),2);assert.equal(await page.evaluate(()=>window.app.composer.librarySourceFilters),undefined);
    await open('library');await choice('creators','alice_ai').check();await choice('orientations','portrait').check();await apply();
    assert.equal(await page.locator('.fc-clip').count(),1);assert.deepEqual(await page.evaluate(()=>window.app.composer.session),before,'browse filters do not change the recipe');
    await page.locator('.fc-source-details summary').click();assert.ok((await page.locator('.fc-source-details').textContent()).includes('Alice_AI'));assert.ok((await page.locator('.fc-source-details').textContent()).includes('1080 × 1920'));
    await page.locator('[data-field=search]').fill('alice_ai model one');assert.equal(await page.locator('.fc-clip').count(),1);await page.locator('[data-field=search]').fill('');
    await open('library');await dialog.locator('[name=source-clear]').click();await apply();assert.equal(await page.locator('.fc-clip').count(),2);
    await open('session');await choice('creators','alice_ai').check();await choice('base_models','model one').check();await choice('orientations','portrait').check();
    await dialog.locator('[name=source-resolution]').fill('1080');await dialog.locator('[name=source-resolution]').press('Tab');
    assert.ok((await dialog.locator('.fc-source-status').textContent()).startsWith('1 matching video'));await apply();
    assert.deepEqual((await prefs()).session.creators,['alice_ai']);assert.deepEqual(await page.evaluate(()=>window.app.composer.session.placements),before.placements);
    assert.ok(await page.locator('.fc-source-warning').isVisible());
    assert.ok(await page.evaluate(()=>{const c=window.app.composer;return c.prepared===c.sourcePrepared&&c.player.snapshot===c.prepared.snapshot&&c.player.intent&&!c.player.audio.paused&&c.sourcePauses===0;}),'applying selection filters preserves prepared preview and audio');
    await page.evaluate(()=>{const c=window.app.composer;c.regionEditor.select(c.session.placements[0].id);});
    assert.equal(await page.locator('[data-field=clip_id] option:not([disabled])').count(),1,'manual choices respect source restrictions');
    await open('section');assert.equal(await dialog.locator('[name=source-mode]').inputValue(),'inherit');
    await choice('creators','bob').check();assert.equal(await dialog.locator('[name=source-mode]').inputValue(),'narrow');
    assert.ok((await dialog.locator('.fc-source-status').textContent()).startsWith('0 matching videos'),'disjoint creator lists are visibly empty');
    await dialog.locator('[name=source-mode]').selectOption('replace');assert.ok((await dialog.locator('.fc-source-status').textContent()).startsWith('1 matching video'));await apply();
    await page.locator('[data-action=assemble]').click({force:true});
    assert.ok(await page.evaluate(()=>{const c=window.app.composer;return c.session.placements.every(p=>c.catalog.clips.find(v=>v.id===p.clip_id).name===(p.section_id===c.session.sections[0].id?'B.mp4':'A.mp4'));}),'section override and session defaults drive actual assembly');
    await open('section');await dialog.locator('[name=source-mode]').selectOption('off');await apply();assert.equal((await prefs()).section.mode,'off');
    await page.locator('[data-action=undo]').click({force:true});assert.equal((await prefs()).section.mode,'replace');
    await page.locator('[data-action=redo]').click({force:true});assert.equal((await prefs()).section.mode,'off');
    await open('section');await dialog.locator('[name=source-mode]').selectOption('inherit');await apply();assert.equal((await prefs()).section,undefined);
    await open('session');
    if(screenshot)await page.screenshot({path:screenshot});
    for(const [width,height] of [[800,700],[560,720]]){
      await page.setViewportSize({width,height});
      assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'source dialog fits narrow windows');
      const button=await dialog.locator('[value=apply]').boundingBox(),bounds=await dialog.boundingBox();assert.ok(button.y>=bounds.y&&button.y+button.height<=Math.min(height,bounds.y+bounds.height),'apply stays visible');
      const creator=await choice('creators','alice_ai').boundingBox();assert.ok(creator.width<=16&&creator.height<=16,'checkbox keeps its own width');
      if(screenshot)await page.screenshot({path:screenshot.replace('.png',`-${width}.png`)});
    }
    await dialog.locator('[value=cancel]').click();await page.setViewportSize({width:1500,height:1080});
    await page.locator('[data-action=save]').click({force:true});await until(()=>!window.app.composer.dirty);
    assert.ok(await page.evaluate(async()=>{const c=window.app.composer,saved=await c.ipc('load',{id:c.session.id});return JSON.stringify(saved.source_filters)===JSON.stringify(c.session.source_filters)&&JSON.stringify(saved.sections)===JSON.stringify(c.session.sections);}), 'source filters persist in the recipe');
    console.log('PASS: creator search/counts, library-only browsing, linked metadata/details, strict session and section filters, actual assembly, manual choices, no playback reset, modes, Undo/Redo, persistence and responsive layout.');
  }finally{
    await page.setViewportSize({width:1500,height:1080});
    await page.evaluate(async()=>{
      const c=window.app.composer;c.root.querySelector('.fc-source-dialog')?.close('cancel');c.player.audio.removeEventListener('pause',c.sourcePauseListener);c.player.audio.loop=false;
      c.invalidate({pause:true});if(c.preparationTask)await c.preparationTask;
      Object.assign(c,c.beforeSources);delete c.beforeSources;delete c.sourcePrepared;delete c.sourcePauses;delete c.sourcePauseListener;
      c.root.querySelector('[data-field=search]').value='';c.position=0;c.loadSongPlayback();c.renderEditor();await c.prepare();
    });
  }
}
