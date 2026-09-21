import assert from 'node:assert/strict';

export async function checkTimelineEditing(page,until){
  const recipe=await page.evaluate(()=>JSON.stringify(window.app.composer.session));
  await page.evaluate(()=>window.app.composer.setPosition(3000));
  await page.locator('.fc-timeline-viewport').evaluate(el=>el.scrollIntoView({block:'center'}));
  const rect=await page.locator('.fc-timeline-viewport').boundingBox(),x=rect.x+rect.width*.65,y=rect.y+12;
  const before=await page.evaluate(x=>window.app.composer.timeline.timeAt(x),x);
  await page.mouse.move(x,y);await page.keyboard.down('Control');await page.mouse.wheel(0,-180);await page.keyboard.up('Control');
  await until(()=>window.app.composer.timeline.zoom>1.1);
  const after=await page.evaluate(x=>window.app.composer.timeline.timeAt(x),x);
  assert.ok(Math.abs(before-after)<15,'Ctrl+wheel zoom preserves the song time under the pointer');
  await page.locator('[data-field=timeline-zoom]').selectOption('256');
  assert.ok(await page.evaluate(()=>{
    const c=window.app.composer,w=c.timeline.viewport.clientWidth;
    return c.timeline.viewport.scrollWidth>w*250&&[...c.root.querySelectorAll('canvas')].every(canvas=>canvas.width<=w*2+2);
  }),'large zoom keeps canvases bounded by viewport size');
  const panStart=await page.evaluate(()=>window.app.composer.timeline.viewport.scrollLeft);
  await page.mouse.move(x,y);await page.mouse.down({button:'middle'});await page.mouse.move(x-90,y,{steps:4});await page.mouse.up({button:'middle'});
  assert.ok(await page.evaluate(start=>window.app.composer.timeline.viewport.scrollLeft>start+75,panStart),'middle-button dragging pans the timeline');
  const wheelStart=await page.evaluate(()=>window.app.composer.timeline.viewport.scrollLeft);
  await page.locator('.fc-timeline-viewport').dispatchEvent('wheel',{deltaY:120,shiftKey:true});
  assert.ok(await page.evaluate(start=>window.app.composer.timeline.viewport.scrollLeft>=start+100,wheelStart),'Shift+wheel pans horizontally');
  const expected=await page.evaluate(x=>window.app.composer.timeline.timeAt(x),x-40);
  await page.mouse.click(x-40,y);
  assert.ok(await page.evaluate(expected=>Math.abs(window.app.composer.position-expected)<5,expected),'ruler seek accounts for zoom and scroll');
  await page.locator('[data-action=zoom-section]').click({force:true});
  assert.ok(await page.evaluate(()=>window.app.composer.timeline.zoom>5&&window.app.composer.timeline.zoom<6));
  await page.locator('[data-action=zoom-fit]').click({force:true});
  assert.ok(await page.evaluate(()=>window.app.composer.timeline.zoom===1&&window.app.composer.timeline.viewport.scrollLeft===0));
  assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session)),recipe,'zooming and panning do not edit the recipe');
  await page.evaluate(()=>window.app.composer.setPosition(200));await page.locator('[data-action=split]').click({force:true});
  await until(()=>window.app.composer.session.sections.length===7);
  await page.evaluate(()=>window.app.composer.setPosition(100));await page.locator('[data-action=split]').click({force:true});
  await until(()=>window.app.composer.session.sections.length===8);
  assert.deepEqual(await page.evaluate(()=>window.app.composer.session.sections.map(s=>s.label)),Array.from({length:8},(_,i)=>`Section ${i+1}`));
  assert.ok((await page.locator('[data-status]').textContent()).includes('independent'));
  assert.equal(await page.locator('.fc-section-folder').count(),8,'every section exposes its own folder control');
  await page.locator('[data-action=undo]').click({force:true});await page.locator('[data-action=undo]').click({force:true});
  assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session)),recipe);
  await page.locator('.fc-section-row[data-section="0"] [data-action=select-section]').click({force:true});
  await page.evaluate(()=>window.app.composer.setPosition(0));
  console.log('PASS: pointer-anchored wheel zoom, 256× bounded canvases, middle/Shift-wheel pan, ruler seeking, fit controls, independent section names and undo.');
}

export async function chooseSectionFolders(page){
  const before=await page.evaluate(()=>JSON.stringify(window.app.composer.session.placements));
  await page.locator('.fc-selection-bar [data-action=section-folders]').click({force:true});
  const viewport=page.viewportSize();
  for(const size of [viewport,{width:828,height:815}]){
    await page.setViewportSize(size);
    const rows=await page.locator('.fc-folder-dialog .fc-check').evaluateAll(labels=>labels.map(label=>{
      const row=label.getBoundingClientRect(),box=label.querySelector('input').getBoundingClientRect(),text=label.querySelector('span')?.getBoundingClientRect();
      return {height:row.height,boxWidth:box.width,boxHeight:box.height,textWidth:text?.width};
    }));
    assert.ok(rows.every(row=>row.boxWidth<=24&&row.boxHeight<=24&&row.height<80&&(row.textWidth===undefined||row.textWidth>200)),`folder labels stay readable beside compact checkboxes at ${size.width}×${size.height}: ${JSON.stringify(rows)}`);
  }
  await page.setViewportSize(viewport);
  await page.locator('.fc-folder-dialog input[value=Pulse]').check({force:true});
  await page.locator('.fc-folder-dialog button[value=cancel]').click({force:true});
  assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session.placements)),before);
  await page.locator('.fc-selection-bar [data-action=section-folders]').click({force:true});
  await page.locator('.fc-folder-dialog input[value=Pulse]').check({force:true});
  await page.locator('.fc-folder-dialog input[value=Flow]').check({force:true});
  await page.locator('.fc-folder-dialog button[value=apply]').click({force:true});
  await page.waitForFunction(()=>!document.querySelector('.fc-folder-dialog'),null,{polling:100});
  assert.equal(await page.evaluate(()=>JSON.stringify(window.app.composer.session.placements)),before,'choosing compatible folders keeps existing clips and trims');
  assert.deepEqual(await page.evaluate(()=>window.app.composer.session.sections[0].categories),['Flow','Pulse']);
  assert.ok((await page.locator('.fc-selection-bar').textContent()).includes('Flow, Pulse'));
}

export async function checkLargeLibrary(page){
  await page.evaluate(()=>{
    const c=window.app.composer;
    c.catalog.clips.push(...Array.from({length:123},(_,i)=>({id:`presentation-${i}`,name:`Sample clip ${String(i+1).padStart(3,'0')}`,duration_ms:4700+i*10,origin:'dataset',review_status:'draft',quality:0,available:false,categories:['Uncategorized']})));
    c.edit(s=>{s.min_rating=0;s.include_drafts=true;},{keepPlacements:true});
    c.root.querySelector('[data-field=library-view]').value='all';c.root.querySelector('[data-field=library-sort]').value='name';
    c.root.querySelector('.fc-library-filters').open=false;c.renderLibrary();
  });
  assert.equal(await page.locator('.fc-clip').count(),129);
  assert.equal(await page.locator('.fc-clips input,.fc-clips select').count(),0);
  assert.equal(await page.locator('.fc-clip-details [data-field=rating]').count(),1);
  assert.ok(await page.evaluate(()=>{
    const list=document.querySelector('.fc-clips');return list.scrollHeight>list.clientHeight&&[...list.querySelectorAll('.fc-clip')].every(row=>row.getBoundingClientRect().height<95);
  }),'129 entries stay in compact, scrollable rows');
  await page.locator('[data-field=search]').fill('Sample clip 123');assert.equal(await page.locator('.fc-clip').count(),1);
  await page.locator('[data-field=search]').fill('');assert.equal(await page.locator('.fc-clip').count(),129);
  await page.locator('[data-action=inspect-library-clip][data-id=presentation-122]').click({force:true});
  assert.equal(await page.locator('.fc-detail-title').textContent(),'Sample clip 123');
  assert.equal(await page.locator('.fc-clip-details [data-action=resolve]').count(),1);
  assert.equal(await page.locator('.fc-clips [data-action=resolve]').count(),0,'resolve controls belong to the selected clip');
  console.log('PASS: 129 compact catalog rows, search, selected details, and one rating/category/resolve editor.');
}
