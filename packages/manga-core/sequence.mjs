const FLF=/^flf_[a-f0-9]{16}$/;

/** A take belongs to one saved FLF pair, even when its source panel is reused. */
export function takeVariant(render){
  const position=render.settings?.reference_position, pair=render.flf_pair?.variant;
  const variant=typeof position==='string'&&position.startsWith('flf_')?position:pair;
  if(variant!=null&&(!FLF.test(variant)||(pair!=null&&pair!==variant)))throw new Error('Invalid joined-panel take identity.');
  return variant||null;
}

/** Match current layout folders, as H3 does; panel names alone can refer to an
 * older layout. Collapse at the opening panel, including cross-page joins. */
export function applyH3Sequence(pages,sequence,folders,issues){
  if(sequence===null)return; // Projects predating H3's saved sequence retain their takes.
  const starts=new Map(),ends=new Set(),used=new Set();
  const pairs=sequence?.schema_version===1&&Array.isArray(sequence.pairs)?sequence.pairs:null;
  if(!pairs)issues.push('Joined-panel sequence is invalid; showing the original panels with single-panel takes.');
  for(const pair of pairs||[]){
    const endpoints=pair?.endpoints;
    if(!FLF.test(pair?.variant)||!Array.isArray(endpoints)||endpoints.length!==2){issues.push('Invalid joined-panel entry; its source panels remain separate.');continue;}
    const source=endpoints.map(e=>e&&folders.get(e.folder));
    if(source.some((p,i)=>!p||p.sourceId!==endpoints[i].panel_id)||source[0]===source[1]||source.some(p=>used.has(p))){issues.push(`${pair.variant}: joined endpoints are missing, overlap, or belong to an old layout; source panels remain separate.`);continue;}
    source.forEach(p=>used.add(p));ends.add(source[1]);
    starts.set(source[0],{variant:pair.variant,label:typeof pair.label==='string'?pair.label:source.map(p=>p.sourceId).join(' → '),sourcePanelIds:source.map(p=>p.sourceId)});
  }
  for(const page of pages){
    const original=page.panels;
    page.panels=original.filter(panel=>!ends.has(panel));
    if(original.length&&!page.panels.length)page.joinedOnly=true;
    for(const panel of page.panels){
      const joined=starts.get(panel);if(joined)panel.joined=joined;
      panel.takes=panel.takes.filter(t=>(t.flfVariant||null)===(joined?.variant||null));
      panel.selected=panel.takes.find(t=>t.id===panel.selected)?.id||panel.takes[0]?.id||null;
      if(joined&&!panel.selected)issues.push(`${panel.sourceId}: no completed take for active join ${joined.variant}; showing still artwork.`);
    }
  }
}

/** A saved reader override can outlive an H3 pairing or take deletion. */
export function selectedTake(panel,override={}){
  return panel?.takes.find(t=>t.id===override.take)||panel?.takes.find(t=>t.id===panel.selected);
}

/** Keep fully consumed endpoint pages available for manual reading, while
 * autoplay and prefetch continue to the next entry in H3's compacted order. */
export function nextReadingPage(pages,index){
  for(let i=index+1;i<pages.length;i++)if(!pages[i].joinedOnly)return i;
  return -1;
}
