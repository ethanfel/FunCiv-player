import assert from 'node:assert/strict';

export async function checkSaveDuringEditing(page,until){
  await page.evaluate(()=>{
    const c=window.app.composer;
    window.beforeSaveRace={session:c.session,history:c.history,revisions:c.revisions,dirty:c.dirty,ipc:c.ipc,saveQueue:c.saveQueue};
    c.history=new c.history.constructor();c.revisions=new Map(c.revisions);
    const gate=new Promise(resolve=>{window.releaseSaveRace=resolve;});
    c.ipc=async function(action,payload){
      if(action!=='save')return window.beforeSaveRace.ipc.call(this,action,payload);
      const saved=structuredClone(payload.session);saved.revision++;window.saveRaceStarted=true;
      await gate;return saved;
    };
  });
  try{
    await page.locator('[data-action=save]').click({force:true});await until(()=>window.saveRaceStarted);
    await page.locator('[data-field=name]').fill('Edited while saving');
    await page.locator('[data-field=name]').dispatchEvent('change');
    await page.evaluate(async()=>{window.releaseSaveRace();await window.app.composer.saveQueue;});
    assert.equal(await page.locator('[data-field=name]').inputValue(),'Edited while saving');
    assert.ok(await page.evaluate(()=>window.app.composer.dirty),'newer edit remains unsaved');
    assert.ok(await page.evaluate(()=>window.app.composer.session.revision===window.beforeSaveRace.session.revision+1));
    assert.deepEqual(await page.evaluate(()=>window.app.composer.session.placements),await page.evaluate(()=>window.beforeSaveRace.session.placements));
  }finally{
    await page.evaluate(()=>{
      const c=window.app.composer;Object.assign(c,window.beforeSaveRace);c.renderEditor();
      delete window.beforeSaveRace;delete window.releaseSaveRace;delete window.saveRaceStarted;
    });
  }
  console.log('PASS: editing during Save preserves the new name, placements and dirty flag.');
}

export async function checkSourceDragEscape(page){
  const before=await page.evaluate(()=>({session:JSON.stringify(window.app.composer.session),history:window.app.composer.history.past.length,dirty:window.app.composer.dirty}));
  const source=page.locator('[data-source-drag]');await source.evaluate(el=>el.scrollIntoView({block:'center'}));await source.focus();
  const box=await source.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,y,{steps:4});
  assert.ok(await page.evaluate(()=>window.app.composer.regionEditor.drag?.changed));
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY','rebuilding the inspector removes focused handle');
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.app.composer.regionEditor.drag),null);
  assert.deepEqual(await page.evaluate(()=>({session:JSON.stringify(window.app.composer.session),history:window.app.composer.history.past.length,dirty:window.app.composer.dirty})),before);
  console.log('PASS: Escape cancels source dragging after focus loss, preserving trims and undo history.');
}
