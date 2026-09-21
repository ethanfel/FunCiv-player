import assert from 'node:assert/strict';

export async function checkDraftAssembly(page,until){
  await page.evaluate(()=>{
    const c=window.app.composer;
    window.beforeDraftAssembly={session:c.session,clips:c.catalog.clips,history:c.history,selected:c.selected,dirty:c.dirty,job:c.job};
    c.session=structuredClone(c.session);c.session.sections=c.session.sections.slice(0,3).map((s,i)=>({...s,start_ms:i*2000,end_ms:(i+1)*2000,categories:['Draft test'],category:undefined}));
    c.session.placements=[];c.session.include_drafts=false;c.session.repeat_policy='never';c.session.min_rating=4;c.selected=0;
    c.catalog.clips=['A.mp4','B.mp4','C.mp4'].map((name,i)=>({...c.catalog.clips.find(clip=>clip.name===name),id:`draft-test-${i}`,origin:i?'dataset':'local',review_status:i?'draft':'local',audio_sync:false,quality:5,user_rating:5,script_ready:true,categories:['Draft test']}));
    c.renderEditor();
  });
  const before=await page.evaluate(()=>JSON.stringify(window.app.composer.session));
  await page.locator('[data-action=assemble]').click({force:true});
  assert.ok((await page.locator('.fc-draft-assembly').textContent()).includes('2 additional draft videos'));
  assert.ok((await page.locator('.fc-draft-assembly').textContent()).includes('4★ minimum'));
  assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session)),before,'proposal leaves the recipe untouched');
  await page.locator('.fc-draft-assembly button[value=cancel]').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session)),before);
  await page.locator('[data-action=assemble]').click({force:true});await page.locator('.fc-draft-assembly button[value=accept]').click();
  await until(()=>window.app.composer.session.placements.length===3);
  assert.ok(await page.evaluate(()=>{const s=window.app.composer.session;return s.include_drafts&&s.min_rating===4&&s.repeat_policy==='never'&&new Set(s.placements.map(p=>p.clip_id)).size===3;}));
  await page.locator('[data-action=undo]').click({force:true});assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session)),before,'one undo restores placement and draft consent');
  // Exercise the scripts-only path with a controlled asynchronous download failure.
  await page.evaluate(()=>{
    const c=window.app.composer;for(const clip of c.catalog.clips.filter(c=>c.origin==='dataset')){clip.script_ready=false;clip.scripts=undefined;clip.remote_scripts={L0:{}};}
    c.testScriptCalls=[];c.job=async(action,payload)=>{c.testScriptCalls.push({action,payload});throw new Error('Synthetic HF fetch failure');};
  });
  await page.locator('[data-action=assemble]').click({force:true});
  assert.equal(await page.locator('.fc-draft-assembly button[value=accept]').textContent(),'Get scripts and use drafts');
  assert.deepEqual(await page.evaluate(()=>window.app.composer.testScriptCalls),[],'no download before accepting the draft proposal');
  await page.locator('.fc-draft-assembly button[value=accept]').click();
  await until(()=>document.querySelector('[data-status]').textContent.includes('Synthetic HF fetch failure'));
  assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session)),before,'failed fetch preserves recipe and opt-in');
  assert.deepEqual(await page.evaluate(()=>window.app.composer.testScriptCalls[0]),{action:'fetch-scripts',payload:{ids:['draft-test-1','draft-test-2']}});
  await page.evaluate(()=>{
    const c=window.app.composer;c.job=async(action,payload)=>{for(const id of payload.ids)c.catalog.clips.find(clip=>clip.id===id).script_ready=true;return {count:payload.ids.length,warnings:[]};};
  });
  await page.locator('[data-action=assemble]').click({force:true});await page.locator('.fc-draft-assembly button[value=accept]').click();
  await until(()=>window.app.composer.session.placements.length===3);
  assert.ok(await page.evaluate(()=>window.app.composer.session.include_drafts));
  await page.locator('[data-action=undo]').click({force:true});assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session)),before);
  await page.evaluate(()=>{
    const c=window.app.composer,old=window.beforeDraftAssembly;
    c.session=old.session;c.catalog.clips=old.clips;c.history=old.history;c.selected=old.selected;c.dirty=old.dirty;c.job=old.job;
    delete c.testScriptCalls;delete window.beforeDraftAssembly;c.renderEditor();
  });
  // The rest of the export/transport fixture deliberately reuses two short videos.
  await page.locator('[data-field=repeat_policy]').selectOption('cycle');
  console.log('PASS: shortage proposes matching drafts, explicit consent, no new repeats, preserved filters, script-fetch failure recovery and one-step undo.');
}
