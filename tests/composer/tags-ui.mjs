import assert from 'node:assert/strict';

export async function checkTagPreferences(page,until,screenshot){
  await page.evaluate(async()=>{
    const c=window.app.composer,{createSession,planRegions,arrange,History}=await import('./../packages/composer-core/index.mjs');
    c.beforeTags={session:c.session,catalog:c.catalog,history:c.history,dirty:c.dirty,selected:c.selected,selectedPlacement:c.selectedPlacement,inspectorMode:c.inspectorMode};
    c.invalidate({pause:true});if(c.preparationTask)await c.preparationTask;
    c.catalog=structuredClone(c.catalog);c.catalog.clips=c.catalog.clips.filter(c=>['A.mp4','B.mp4','C.mp4'].includes(c.name));
    const a=c.catalog.clips.find(c=>c.name==='A.mp4');a.tags=['glasses'];
    c.catalog.clips.find(c=>c.name==='B.mp4').tags=['indoors',...Array.from({length:95},(_,i)=>`test tag ${i}`)];
    c.catalog.clips.find(c=>c.name==='C.mp4').tags=['blue hair','outdoors'];
    c.catalog.clips.push({...structuredClone(a),id:'tag-draft-alias',origin:'dataset',review_status:'draft',tags:['blue hair']});
    let session=createSession(c.session.song,2);session.min_rating=4;session.repeat_policy='cycle';
    for(const section of session.sections){section.motion='hold';session=planRegions(session,section.id,[section.start_ms+1500]);}
    c.session=arrange(session,c.catalog.clips);c.history=new History();c.selected=0;c.position=0;c.loadSongPlayback();
    c.root.querySelector('[data-field=search]').value='';c.root.querySelector('[data-field=library-view]').value='all';c.renderEditor();
    await c.prepare();c.tagPrepared=c.prepared;c.player.audio.loop=true;await c.player.play();
    c.tagPauses=0;c.tagPauseListener=()=>c.tagPauses++;c.player.audio.addEventListener('pause',c.tagPauseListener);
  });
  const dialog=page.locator('.fc-tag-dialog'),search=dialog.locator('[name=tag-search]');
  const openSession=()=>page.locator('[data-action=session-tags]').click({force:true});
  const openSection=()=>page.locator('.fc-selection-bar [data-action=section-tags]').click({force:true});
  const apply=async()=>{await dialog.locator('[value=apply]').click();await until(()=>!document.querySelector('.fc-tag-dialog'));};
  const choose=(tag,list)=>dialog.locator(`[data-tag-choice="${tag}"][data-list=${list}]`).click();
  const getPrefs=()=>page.evaluate(()=>{const c=window.app.composer;return {session:c.session.tag_preferences,section:c.session.sections[0].tag_preferences};});
  try{
    const placements=await page.evaluate(()=>structuredClone(window.app.composer.session.placements));
    await openSession();assert.ok((await dialog.locator('[data-tag-results-count]').textContent()).includes('showing 80'));
    await search.fill('BLUE_HAIR');assert.equal(await dialog.locator('.fc-tag-result').count(),1);
    assert.equal(await dialog.locator('.fc-tag-result>small').textContent(),'1 / 2');
    await choose('blue hair','prefer');await dialog.locator('[value=cancel]').click();
    assert.deepEqual(await getPrefs(),{session:undefined,section:undefined});
    await openSession();await search.fill('blue_hair');await choose('blue hair','prefer');
    await search.fill('indoors');await choose('indoors','less');await apply();
    assert.deepEqual((await getPrefs()).session,{prefer:['blue hair'],less:['indoors']});
    assert.deepEqual(await page.evaluate(()=>window.app.composer.session.placements),placements);
    assert.ok(await page.evaluate(()=>{const c=window.app.composer;return c.prepared===c.tagPrepared&&c.player.snapshot===c.prepared.snapshot&&!c.player.audio.paused&&c.player.intent&&c.tagPauses===0;}),'preferences leave prepared video and audio running');
    await openSection();assert.equal(await dialog.locator('[name=tag-mode]').inputValue(),'inherit');
    assert.ok((await dialog.locator('.fc-tag-inherited').textContent()).includes('blue hair'));
    await search.fill('blue hair');await choose('blue hair','less');assert.equal(await dialog.locator('[name=tag-mode]').inputValue(),'add');await apply();
    assert.deepEqual((await getPrefs()).section,{mode:'add',prefer:[],less:['blue hair']});
    assert.deepEqual(await page.evaluate(async()=>{const c=window.app.composer,{effectiveTagPreferences}=await import('./../packages/composer-core/tags.mjs');return effectiveTagPreferences(c.session,c.session.sections[0]);}),{prefer:[],less:['blue hair','indoors']});
    await openSection();await dialog.locator('[name=tag-mode]').selectOption('off');await apply();
    assert.deepEqual((await getPrefs()).section,{mode:'off',prefer:[],less:['blue hair']},'off remembers local choices');
    await openSection();await dialog.locator('[name=tag-mode]').selectOption('replace');await apply();
    assert.equal((await getPrefs()).section.mode,'replace');
    await openSection();await dialog.locator('[name=tag-mode]').selectOption('inherit');await apply();
    assert.equal((await getPrefs()).section,undefined);
    await page.locator('[data-action=undo]').click({force:true});assert.equal((await getPrefs()).section.mode,'replace');
    await page.locator('[data-action=redo]').click({force:true});assert.equal((await getPrefs()).section,undefined);
    await openSection();await search.fill('outdoors');await choose('outdoors','prefer');await apply();
    await page.locator('[data-field=search]').fill('BLUE_HAIR glasses');
    assert.equal(await page.locator('.fc-clip').count(),1,'word search includes shared HF labels and respects draft exclusion');
    await page.locator('.fc-clip [data-action=inspect-library-clip]').click({force:true});
    assert.equal(await page.locator('.fc-detail-tags summary').textContent(),'Tags · 2');
    await page.locator('[data-field=search]').fill('');
    await openSection();await search.fill('');
    if(screenshot)await page.screenshot({path:screenshot});
    for(const [width,height] of [[800,700],[560,720]]){
      await page.setViewportSize({width,height});
      assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog has no horizontal overflow');
      const box=await dialog.locator('[value=apply]').boundingBox(),bounds=await dialog.boundingBox();
      assert.ok(box.y>=bounds.y&&box.y+box.height<=bounds.y+bounds.height&&box.y+box.height<=height,'apply stays visible inside the dialog');
      assert.ok(await dialog.locator('.fc-tag-results').evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight>=65),'results have their own scrolling space');
      const first=await dialog.locator('.fc-tag-result').first().boundingBox(),footer=await dialog.locator('footer').boundingBox();
      assert.ok(first.y+first.height<=footer.y,'first matching tag is visible without scrolling the form');
      if(screenshot)await page.screenshot({path:screenshot.replace('.png',`-${width}.png`)});
    }
    await dialog.locator('[value=cancel]').click();
    await page.setViewportSize({width:1500,height:1080});
    await page.locator('[data-action=save]').click({force:true});await until(()=>!window.app.composer.dirty);
    assert.ok(await page.evaluate(async()=>{const c=window.app.composer,saved=await c.ipc('load',{id:c.session.id});return JSON.stringify(saved.tag_preferences)===JSON.stringify(c.session.tag_preferences)&&JSON.stringify(saved.sections)===JSON.stringify(c.session.sections);}), 'both preference scopes survive save/load');
    console.log('PASS: searchable tags, unique-video counts, draft/local sharing, session and section modes, no playback reset on Apply, tag search, persistence, Undo/Redo and responsive picker.');
  }finally{
    await page.setViewportSize({width:1500,height:1080});
    await page.evaluate(async()=>{
      const c=window.app.composer;c.root.querySelector('.fc-tag-dialog')?.close('cancel');
      c.player.audio.removeEventListener('pause',c.tagPauseListener);c.player.audio.loop=false;c.invalidate({pause:true});if(c.preparationTask)await c.preparationTask;
      Object.assign(c,c.beforeTags);delete c.beforeTags;delete c.tagPrepared;delete c.tagPauses;delete c.tagPauseListener;
      c.root.querySelector('[data-field=search]').value='';c.position=0;c.loadSongPlayback();c.renderEditor();await c.prepare();
    });
  }
}
