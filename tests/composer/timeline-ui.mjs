import assert from 'node:assert/strict';

export async function checkFolderCollections(page,screenshot){
  await page.evaluate(()=>{
    const c=window.app.composer;c.folderTestOriginal={catalog:c.catalog,session:c.session,history:c.history,dirty:c.dirty};
    const base={duration_ms:6000,available:true,script_ready:true,review_status:'local'};
    const local={...base,id:'september',name:'September video',civitai_id:'42',path:'/collection/September_2026/Pulse/video.mp4',categories:['Pulse']};
    c.catalog={...c.catalog,roots:['/collection','/collection/September_2026'],clips:[
      local,{...local,id:'hf-september',origin:'dataset',local_video_id:local.id,review_status:'draft',category_paths:['September_2026/Pulse']},
      {...base,id:'goblin',name:'Goblin video',path:'/collection/Goblin/Pulse/video.mp4',categories:['Goblin/Pulse']},
      {...base,id:'older',name:'Older video',path:'/collection/September_old/Flow/video.mp4',categories:['Flow']},
    ]};
    c.session=structuredClone(c.session);c.session.min_rating=0;c.session.sections[0].categories=[];c.session.sections[0].folders=[];c.selected=0;c.renderEditor();
  });
  await page.locator('.fc-selection-bar [data-action=section-folders]').click({force:true});
  const input=path=>page.locator(`.fc-folder-tree input[value='${JSON.stringify(['local',path])}']`);
  assert.equal(await input('/collection/September_2026').count(),1,'nested scan root appears once');
  assert.equal(await page.locator('.fc-folder-choices input[value=Pulse]').count(),1,'category aliases share one row');
  assert.ok((await page.locator('.fc-pool-summary').textContent()).includes('3 unique videos selected · 4 catalog records grouped'));
  await input('/collection/September_2026').check();
  assert.equal(await page.locator('.fc-folder-choices input[value=Flow]').count(),0,'categories follow the selected collection');
  assert.ok((await page.locator('.fc-pool-summary').textContent()).includes('1 ready / 1 unique videos selected'));
  await page.locator('.fc-folder-choices input[value=Pulse]').check();
  await page.locator('[name=category-search]').fill('missing');
  assert.equal(await page.locator('.fc-folder-choices input').count(),0);
  await page.locator('[name=category-search]').press('Enter');
  assert.equal(await page.locator('.fc-folder-dialog[open]').count(),1,'Enter in search does not submit or index a folder');
  await page.locator('[name=category-search]').fill('');assert.equal(await page.locator('.fc-folder-choices input[value=Pulse]').isChecked(),true,'search preserves choices');
  const viewport=page.viewportSize();await page.setViewportSize({width:828,height:940});
  assert.ok(await page.locator('.fc-folder-dialog').evaluate(el=>{
    const r=el.getBoundingClientRect(),button=el.querySelector('[value=apply]').getBoundingClientRect();
    return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&button.bottom<=r.bottom;
  }),'dialog and Apply stay inside viewport');
  await page.screenshot({path:screenshot});await page.setViewportSize(viewport);
  await page.locator('.fc-folder-dialog [value=apply]').click();
  await page.waitForFunction(()=>!document.querySelector('.fc-folder-dialog'));
  assert.deepEqual(await page.evaluate(()=>window.app.composer.session.sections[0].folders),[{source:'local',path:'/collection/September_2026'}]);
  assert.ok((await page.locator('.fc-selection-bar').textContent()).includes('September_2026'));
  await page.locator('.fc-selection-bar [data-action=section-folders]').click({force:true});
  assert.equal(await input('/collection/September_2026').isChecked(),true,'scope restored when reopening');
  await page.locator('[name=clear]').click();await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.fc-folder-dialog'));
  assert.deepEqual(await page.evaluate(()=>window.app.composer.session.sections[0].folders),[{source:'local',path:'/collection/September_2026'}],'Escape cancels scope changes');
  await page.evaluate(()=>{const c=window.app.composer;Object.assign(c,c.folderTestOriginal);delete c.folderTestOriginal;c.renderEditor();});
  console.log('PASS: nested folder tree, scoped categories, unique-video counts, search, compact dialog, Apply/reopen and Escape.');
}

export async function checkLibraryReadiness(page,screenshot){
  const previous=await page.evaluate(()=>{
    const c=window.app.composer,old={roots:c.catalog.roots,view:c.root.querySelector('[data-field=library-view]').value,selected:c.clipLibrary.selected};
    c.catalog.roots=[];
    const video=c.catalog.clips.find(c=>c.name==='A.mp4');
    c.catalog.clips.push({...video,id:'needs-hf-scripts',origin:'dataset',name:'Local video with HF scripts',categories:['Pending scripts'],quality:5,intensity:4,intensity_mode:'auto',user_rating:undefined,review_status:'approved',scripts:undefined,script_ready:false,remote_scripts:{L0:{}}});
    c.root.querySelector('[data-field=library-view]').value='all';c.renderLibrary();return old;
  });
  assert.ok((await page.locator('.fc-local-library').textContent()).includes('No local folder indexed'));
  assert.equal(await page.locator('.fc-local-library [data-action=fetch-scripts]').textContent(),'Get HF scripts · 1 local video');
  await page.locator('[data-action=inspect-library-clip][data-id=needs-hf-scripts]').click({force:true});
  assert.ok((await page.locator('.fc-file-status').textContent()).includes('Local video linked'));
  assert.ok((await page.locator('.fc-file-status').textContent()).includes('A.mp4'));
  assert.ok((await page.locator('.fc-intensity').textContent()).includes('4/5 · Automatic estimate'));
  assert.ok((await page.locator('.fc-intensity').textContent()).includes('Stored for future song matching'));
  assert.ok(await page.locator('.fc-intensity small').evaluateAll(lines=>lines[1].getBoundingClientRect().top>=lines[0].getBoundingClientRect().bottom),'intensity value and explanation occupy separate readable lines');
  assert.equal(await page.locator('.fc-clip-details [data-action=fetch-scripts]').textContent(),'Get HF scripts');
  assert.equal(await page.locator('.fc-clip-details [data-action=resolve]').count(),0,'linked video offers scripts only');
  await page.locator('.fc-selection-bar [data-action=section-folders]').click({force:true});
  assert.ok((await page.locator('.fc-folder-help').textContent()).includes('No local folders indexed'));
  assert.ok((await page.locator('.fc-folder-header').textContent()).includes('drafts excluded'));
  const folder=category=>page.locator('.fc-folder-choices label').filter({has:page.locator(`input[value="${category}"]`)});
  assert.ok((await folder('Pulse').getAttribute('title')).includes('video not linked'));
  assert.ok((await folder('Draft').getAttribute('title')).includes('drafts excluded'));
  assert.ok((await folder('Pending scripts').getAttribute('title')).includes('1 needs HF scripts'));
  assert.equal(await page.locator('.fc-folder-dialog button[value=index]').count(),1);
  assert.ok(!(await page.locator('.fc-folder-choices').textContent()).includes('eligible'));
  await page.screenshot({path:screenshot});
  await page.locator('.fc-folder-dialog button[value=cancel]').click({force:true});
  // Check the bulk action selects linked, qualifying videos only, without a live network request.
  await page.evaluate(()=>{const c=window.app.composer;c.testJob=c.job;c.job=async(action,payload)=>{c.testScriptRequest={action,payload};return {count:payload.ids.length,warnings:[]};};});
  await page.locator('.fc-local-library [data-action=fetch-scripts]').click({force:true});
  assert.deepEqual(await page.evaluate(()=>window.app.composer.testScriptRequest),{action:'fetch-scripts',payload:{ids:['needs-hf-scripts']}});
  await page.evaluate(old=>{
    const c=window.app.composer;c.job=c.testJob;delete c.testJob;delete c.testScriptRequest;
    c.catalog.clips=c.catalog.clips.filter(c=>c.id!=='needs-hf-scripts');c.catalog.roots=old.roots;
    c.clipLibrary.selected=old.selected;c.root.querySelector('[data-field=library-view]').value=old.view;c.renderLibrary();
  },previous);
  assert.ok((await page.locator('.fc-local-library').textContent()).includes('1 local folder indexed'));
  assert.equal(await page.locator('.fc-local-library [data-action=rescan]').count(),1);
  console.log('PASS: local folder guidance, linked file paths, separate readiness/filter reasons, and scripts-only bulk selection.');
}

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
    const rows=await page.locator('.fc-folder-choices .fc-check,.fc-folder-dialog .fc-pool-all').evaluateAll(labels=>labels.map(label=>{
      const row=label.getBoundingClientRect(),box=label.querySelector('input').getBoundingClientRect(),text=label.querySelector('span')?.getBoundingClientRect();
      return {height:row.height,boxWidth:box.width,boxHeight:box.height,textWidth:text?.width};
    }));
    assert.ok(rows.every(row=>row.boxWidth<=24&&row.boxHeight<=24&&row.height<80&&(row.textWidth===undefined||row.textWidth>140)),`folder labels stay readable beside compact checkboxes at ${size.width}×${size.height}: ${JSON.stringify(rows)}`);
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
