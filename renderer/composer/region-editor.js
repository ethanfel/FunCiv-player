import { clone, validateSession, sectionCategories, matchesSection, sectionRegions, planRegions, splitRegion, mergeRegion, moveRegionEdge, slipSource, suggestRegionCuts, snapToAudio, clipRating, allowsClipReview, sourceTime, isAudioSyncClip, hasMotionForSection } from '../../packages/composer-core/index.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=ms=>(ms/1000).toFixed(3);
export const REGION_TOOLS=`<div class="fc-region-tools"><strong>Clip regions</strong><button data-action="mark-in">Mark in</button><button data-action="mark-out">Mark out</button><button data-action="split-region" title="Split a video region inside its existing song section">Split clip at playhead</button><button data-action="merge-region">Merge next clip</button><label class="fc-check"><input data-field="snap-audio" type="checkbox" checked> Snap to audio</label></div>
<div class="fc-region-tools"><label>Suggested spacing<select data-field="region-beats"><option value="2">2 beats</option><option value="4" selected>4 beats</option><option value="8">8 beats</option><option value="16">16 beats</option></select></label><button data-action="suggest-regions">Suggest audio cuts</button><button data-action="apply-regions" disabled>Apply suggested cuts</button><button data-action="auto-regions">Auto clip lengths</button><small data-region-hint>Sections set category pools. Regions set clip timing.</small></div>`;

export class RegionEditor {
  constructor(view){
    this.view=view;this.root=view.root;
    this.root.addEventListener('pointerdown',event=>this.beginDrag(event));
    this.root.addEventListener('pointermove',event=>this.moveDrag(event));
    this.root.addEventListener('pointerup',()=>this.finishDrag());
    this.root.addEventListener('pointercancel',()=>this.finishDrag(true));
    this.root.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.drag){event.preventDefault();this.finishDrag(true);}});
  }
  commit(next){this.suggestion=null;this.view.edit(s=>Object.assign(s,next),{keepPlacements:true});}
  selected(){return this.view.session?.placements.find(p=>p.id===this.view.selectedPlacement);}
  select(id){const p=this.view.session?.placements.find(p=>p.id===id);if(!p)return;this.view.inspectorMode='clip';this.view.selectedPlacement=id;this.view.selected=this.view.session.sections.findIndex(s=>s.id===p.section_id);this.view.renderEditor();}
  async action(action){
    if(!['mark-in','mark-out','split-region','merge-region','suggest-regions','apply-regions','auto-regions'].includes(action))return false;
    const v=this.view,s=v.session;if(!s)throw new Error('Load a song first.');
    const at=Math.round(v.position||0),section=s.sections[v.selected];
    if(action==='mark-in'){this.markIn={at,session:s.id};v.message(`Region start marked at ${time(at)} s. Move the playhead, then Mark out.`);return true;}
    if(action==='mark-out'){
      if(this.markIn?.session!==s.id)throw new Error('Mark a region start first.');
      const start=this.markIn.at,parent=s.sections.find(p=>start>=p.start_ms&&start<p.end_ms);
      if(!parent||at<=start||at>parent.end_ms)throw new Error('Mark the end after the start, inside the same large section.');
      const cuts=[...new Set([...sectionRegions(s,parent).flatMap(p=>[p.start_ms,p.end_ms]).filter(t=>t<=start||t>=at),start,at])].filter(t=>t>parent.start_ms&&t<parent.end_ms).sort((a,b)=>a-b);
      const next=planRegions(s,parent.id,cuts);v.selected=next.sections.findIndex(p=>p.id===parent.id);v.selectedPlacement=next.placements.find(p=>p.start_ms===start&&p.end_ms===at)?.id;
      v.inspectorMode='clip';this.commit(next);this.markIn=null;v.message('Song region marked. Assemble or choose a clip, then drag its source window to choose the portion.');return true;
    }
    if(action==='split-region'){
      const parent=s.sections.find(p=>at>p.start_ms&&at<p.end_ms);if(!parent)throw new Error('Move the playhead inside a section.');
      const next=splitRegion(s,parent.id,at);v.inspectorMode='clip';v.selected=next.sections.findIndex(p=>p.id===parent.id);v.selectedPlacement=next.placements.find(p=>p.start_ms===at)?.id;this.commit(next);return true;
    }
    if(action==='merge-region'){this.commit(mergeRegion(s,v.selectedPlacement,v.catalog.clips));return true;}
    if(action==='suggest-regions'){
      const cuts=suggestRegionCuts(s.analysis?{...s.analysis,bpm:s.bpm||s.analysis.bpm}:null,section,Number(this.root.querySelector('[data-field=region-beats]').value));
      this.suggestion={session:s,section_id:section.id,cuts};this.renderTrack();
      v.message(`${cuts.length} suggested cuts in ${section.label}. Orange lines are beat/texture suggestions, not confirmed verse boundaries. Review them, then Apply suggested cuts.`);return true;
    }
    if(action==='apply-regions'){
      if(this.suggestion?.session!==s)throw new Error('Suggest cuts again after editing the session.');
      const next=planRegions(s,this.suggestion.section_id,this.suggestion.cuts);this.commit(next);v.message('Regions created. Assemble to fill them; adjust any boundary with its handle.');return true;
    }
    if(action==='auto-regions'){
      if(section.locked||sectionRegions(s,section).some(p=>p.locked))throw new Error('Unlock this section and its clips first.');
      const next=clone(s);next.sections[v.selected].planned_regions=false;next.placements=next.placements.filter(p=>p.section_id!==section.id);delete next.asset_bindings;
      this.commit(next);v.message('This section will use automatic clip lengths on its next assembly.');return true;
    }
  }
  change(input){
    const field=input.dataset.field,v=this.view;
    if(field==='timeline-zoom'){v.timeline.setZoom(Number(input.value));return true;}
    if(field==='zoom-slider'){v.timeline.setZoom(2**Number(input.value));return true;}
    if(['snap-audio','region-beats','follow-playhead'].includes(field))return true;
    if(field==='section-category'||field==='section-all'){
      const section=v.session.sections[v.selected],pool=new Set(sectionCategories(section));
      if(field==='section-all')pool.clear();else if(input.checked)pool.add(input.dataset.category);else pool.delete(input.dataset.category);
      this.setCategories(section.id,[...pool]);return true;
    }
    if(['region-start','region-end'].includes(field)){this.commit(moveRegionEdge(v.session,v.selectedPlacement,field==='region-start'?'start':'end',Number(input.value)*1000,v.catalog.clips));return true;}
    if(field==='source_in_ms'||field==='source-offset'){this.commit(slipSource(v.session,v.selectedPlacement,Number(input.value)*(field==='source_in_ms'?1000:1),v.catalog.clips));return true;}
    if(field==='clip_id'||field==='rate'||field==='clip-locked'){
      const next=clone(v.session),p=next.placements.find(p=>p.id===v.selectedPlacement);if(!p)throw new Error('Select a clip region first.');
      if(field==='clip-locked'){if(!p.clip_id&&input.checked)throw new Error('Assign a clip before keeping it.');p.locked=input.checked;}
      else if(field==='clip_id'){if(!input.value)throw new Error('Choose a clip.');p.clip_id=input.value;p.source_in_ms=0;p.locked=true;}
      else{p.rate=Number(input.value);p.locked=true;}
      next.sections.find(s=>s.id===p.section_id).planned_regions=true;delete next.asset_bindings;validateSession(next,v.catalog.clips);this.commit(next);return true;
    }
    return false;
  }
  setCategories(id,categories){
    const v=this.view,next=clone(v.session),section=next.sections.find(s=>s.id===id);if(!section)throw new Error('Select a song section first.');
    section.categories=categories;delete section.category;section.locked=false;
    const regions=sectionRegions(next,section);if(regions.length)section.planned_regions=true;
    for(const p of regions){const clip=v.catalog.clips.find(c=>c.id===p.clip_id);if(!clip||!matchesSection(clip,section)){p.clip_id=null;p.source_in_ms=0;p.rate=1;p.locked=false;}}
    delete next.asset_bindings;this.commit(next);
  }
  folders(id){
    const v=this.view,session=v.session,section=session?.sections.find(s=>s.id===id);if(!section)throw new Error('Load a song and select a section.');
    v.selectSection(session.sections.indexOf(section));
    const selected=new Set(sectionCategories(section)),categories=[...new Set(v.catalog.clips.flatMap(c=>c.categories||[]).concat([...selected]))].sort();
    const dialog=document.createElement('dialog');dialog.className='fc-dialog fc-folder-dialog';
    dialog.innerHTML=`<form method="dialog"><h2>Folders for ${esc(section.label)}</h2><p>This is a full song section. Its clips may come from any category you check.</p><label class="fc-check"><input name="any" type="checkbox" ${selected.size?'':'checked'}> Any folder / category</label><div class="fc-folder-choices">${categories.map(category=>{
      const pool=v.catalog.clips.filter(c=>c.categories?.includes(category)),eligible=pool.filter(c=>c.available&&allowsClipReview(session,c)&&clipRating(c)>=v.minimumRating()&&hasMotionForSection(c,section));
      return `<label class="fc-check"><input name="category" value="${esc(category)}" type="checkbox" ${selected.has(category)?'checked':''}><span>${esc(category)}<small>${eligible.length} eligible · ${pool.length} catalog clips</small></span></label>`;
    }).join('')||'<p>Add a local folder or sync the dataset to get categories.</p>'}</div><p>Categories come from local folders and HF metadata. Sync FunCiv Data to import published labels; select a library clip to override its category. Ratings, draft settings and available scripts still apply.</p><div class="fc-actions"><button value="cancel">Cancel</button><button value="apply" class="fc-primary">Apply folders</button></div></form>`;
    dialog.addEventListener('change',event=>{
      if(event.target.name==='any'&&event.target.checked)dialog.querySelectorAll('[name=category]').forEach(c=>{c.checked=false;});
      if(event.target.name==='category')dialog.querySelector('[name=any]').checked=![...dialog.querySelectorAll('[name=category]')].some(c=>c.checked);
    });
    dialog.addEventListener('close',()=>{
      const choice=[...dialog.querySelectorAll('[name=category]:checked')].map(c=>c.value);dialog.remove();
      if(dialog.returnValue!=='apply')return;
      try{if(v.session!==session)throw new Error('The session changed. Open its folder choices again.');this.setCategories(id,choice);v.message('Folder choices applied. Compatible clips and trims are kept; assemble to fill empty regions.');}catch(e){v.message(e.message,true);}
    });
    this.root.append(dialog);dialog.showModal();
  }
  renderTrack(){
    const v=this.view,s=v.session;if(!s)return;
    const clips=new Map(v.catalog.clips.map(c=>[c.id,c])),duration=s.song.duration_ms;
    const empty=s.sections.filter(section=>!sectionRegions(s,section).length).map(section=>`<button class="fc-unassembled" data-action="section-folders" data-id="${esc(section.id)}" style="left:${section.start_ms/duration*100}%;width:${(section.end_ms-section.start_ms)/duration*100}%" title="Choose folders for ${esc(section.label)}, then Assemble">No clips · choose folders</button>`).join('');
    this.root.querySelector('.fc-placement-strip').innerHTML=empty+s.placements.map(p=>{
      const regions=sectionRegions(s,s.sections.find(s=>s.id===p.section_id)),index=regions.indexOf(p),title=`${clips.get(p.clip_id)?.name||'Empty region'} · ${time(p.start_ms)}–${time(p.end_ms)} s`;
      return `<div class="fc-region ${p.id===v.selectedPlacement?'fc-selected':''} ${p.clip_id?'':'fc-region-empty'}" style="width:${(p.end_ms-p.start_ms)/duration*100}%;left:${p.start_ms/duration*100}%"><button data-placement="${esc(p.id)}" title="${esc(title)}">${esc(clips.get(p.clip_id)?.name||'Choose clip')}${p.locked?' · kept':''}</button><button class="fc-region-handle fc-region-start" data-region-edge="start" data-region-id="${esc(p.id)}" aria-label="Move region start at ${time(p.start_ms)} seconds" ${index===0?'disabled':''}></button><button class="fc-region-handle fc-region-end" data-region-edge="end" data-region-id="${esc(p.id)}" aria-label="Move region end at ${time(p.end_ms)} seconds" ${index===regions.length-1?'disabled':''}></button></div>`;
    }).join('');
    const valid=this.suggestion?.session===s;
    this.root.querySelector('[data-action=apply-regions]').disabled=!valid;
    this.root.querySelector('.fc-audio-markers').innerHTML=valid?this.suggestion.cuts.map(at=>`<span style="left:${at/duration*100}%" title="Suggested audio cut: ${time(at)} s"></span>`).join(''):'';
  }
  inspectorHTML(){
    const v=this.view,s=v.session,p=this.selected();if(!p)return '<p>Select a clip region to edit its timing and source portion.</p>';
    const section=s.sections.find(s=>s.id===p.section_id),regions=sectionRegions(s,section),index=regions.indexOf(p),clip=v.catalog.clips.find(c=>c.id===p.clip_id);
    const required=(p.end_ms-p.start_ms)*p.rate;
    const choices=v.catalog.clips.filter(c=>c.available&&clipRating(c)>=v.minimumRating()&&matchesSection(c,section)&&allowsClipReview(v.session,c)&&c.duration_ms>=required&&hasMotionForSection(c,section));
    const current=p.clip_id&&!choices.some(c=>c.id===p.clip_id)?`<option value="${esc(p.clip_id)}" selected disabled>Current: ${esc(clip?.name||'Missing clip')} (outside filters)</option>`:'';
    const max=clip?Math.max(0,clip.duration_ms-required):0;
    return `<h3>Selected clip region</h3><label>Song start (seconds)<input data-field="region-start" type="number" step="0.001" value="${time(p.start_ms)}" ${index===0?'disabled':''}></label><label>Song end (seconds)<input data-field="region-end" type="number" step="0.001" value="${time(p.end_ms)}" ${index===regions.length-1?'disabled':''}></label><small>Drag a region edge to move the shared cut. Neighbors stay joined.</small>
      <label>${p.clip_id?'Replace with':'Assign clip'}<select data-field="clip_id"><option value="" ${!p.clip_id?'selected':''} disabled>Choose a clip…</option>${current}${choices.map(c=>`<option value="${esc(c.id)}" ${c.id===p.clip_id?'selected':''}>${clipRating(c)||'–'}★ · ${esc(c.name)}</option>`).join('')}</select></label>${!choices.length?'<small>No qualifying clip is long enough. Shorten/split this region or select another folder category.</small>':''}
      ${isAudioSyncClip(clip)?`<p class="fc-audio-sync-note">Audio sync · ${section.motion==='hold'?'Neutral hold is selected for this section.':'This region uses song-generated strokes; secondary axes stay neutral. Analyze the song before preparing preview.'}</p>`:''}
      ${clip?`<video class="fc-source-preview" data-source-preview muted playsinline controls preload="metadata"></video><label>Source portion · drag the window<div class="fc-source-rail"><button class="fc-source-window" data-source-drag="${esc(p.id)}" title="Move the source portion without changing song timing" style="left:${p.source_in_ms/clip.duration_ms*100}%;width:${required/clip.duration_ms*100}%">↔</button></div></label><label>Source start<input data-field="source-offset" type="range" min="0" max="${max}" step="1" value="${p.source_in_ms}" ${max===0?'disabled':''}></label><label>Source in (seconds)<input data-field="source_in_ms" type="number" min="0" max="${max/1000}" step="0.001" value="${time(p.source_in_ms)}"></label><small data-source-summary>Using ${time(p.source_in_ms)}–${time(sourceTime(p,p.end_ms))} s of ${time(clip.duration_ms)} s</small><label>Speed<input data-field="rate" type="number" min="0.25" max="4" step="0.05" value="${p.rate}"></label><label class="fc-check"><input data-field="clip-locked" type="checkbox" ${p.locked?'checked':''}> Keep this clip and trim on variation</label>`:''}`;
  }
  bindSourcePreview(){
    const video=this.root.querySelector('[data-source-preview]'),p=this.selected(),clip=this.view.catalog.clips.find(c=>c.id===p?.clip_id);if(!video||!clip)return;
    video.addEventListener('loadedmetadata',()=>{video.currentTime=(this.selected()?.source_in_ms??p.source_in_ms)/1000;});
    video.addEventListener('play',()=>{this.view.player.pause();this.view.devices.release();const current=this.selected();if(!current)return;if(video.currentTime<current.source_in_ms/1000||video.currentTime>=sourceTime(current,current.end_ms)/1000)video.currentTime=current.source_in_ms/1000;});
    video.addEventListener('timeupdate',()=>{const current=this.selected();if(current&&video.currentTime>=sourceTime(current,current.end_ms)/1000)video.pause();});
    video.src=clip.url;
  }
  pauseSource(){this.root.querySelector('[data-source-preview]')?.pause();}
  beginDrag(event){
    const edge=event.target.closest('[data-region-edge]'),source=event.target.closest('[data-source-drag]');if((!edge&&!source)||event.button!==0||event.target.disabled)return;
    const v=this.view,id=edge?.dataset.regionId||source.dataset.sourceDrag,p=v.session?.placements.find(p=>p.id===id);if(!p)return;
    event.preventDefault();this.pauseSource();v.invalidate();v.inspectorMode='clip';v.selectedPlacement=id;v.selected=v.session.sections.findIndex(s=>s.id===p.section_id);
    const rect=(edge?this.root.querySelector('.fc-placement-strip'):this.root.querySelector('.fc-source-rail')).getBoundingClientRect();
    this.drag={initial:v.session,dirty:v.dirty,id,pointer:event.pointerId,x:event.clientX,edge:edge?.dataset.regionEdge,scale:(edge?v.session.song.duration_ms:v.catalog.clips.find(c=>c.id===p.clip_id).duration_ms)/rect.width,origin:edge?p[edge.dataset.regionEdge+'_ms']:p.source_in_ms};
    this.root.setPointerCapture(event.pointerId);this.root.classList.add('fc-dragging');v.renderInspector();
  }
  moveDrag(event){
    const d=this.drag;if(!d||event.pointerId!==d.pointer)return;event.preventDefault();
    let at=d.origin+(event.clientX-d.x)*d.scale;
    if(d.edge&&this.root.querySelector('[data-field=snap-audio]').checked&&!event.altKey)at=snapToAudio(at,d.initial.analysis);
    try{
      const next=d.edge?moveRegionEdge(d.initial,d.id,d.edge,at,this.view.catalog.clips):slipSource(d.initial,d.id,at,this.view.catalog.clips);
      validateSession(next,this.view.catalog.clips);this.view.session=next;d.changed=JSON.stringify(next.placements)!==JSON.stringify(d.initial.placements);this.renderTrack();
      const p=this.selected(),clip=this.view.catalog.clips.find(c=>c.id===p.clip_id);
      for(const [field,value] of [['region-start',time(p.start_ms)],['region-end',time(p.end_ms)],['source_in_ms',time(p.source_in_ms)],['source-offset',p.source_in_ms]]){const input=this.root.querySelector(`[data-field=${field}]`);if(input)input.value=value;}
      if(clip){const block=this.root.querySelector('.fc-source-window');if(block){block.style.left=`${p.source_in_ms/clip.duration_ms*100}%`;block.style.width=`${(p.end_ms-p.start_ms)*p.rate/clip.duration_ms*100}%`;}
        const label=this.root.querySelector('[data-source-summary]');if(label)label.textContent=`Using ${time(p.source_in_ms)}–${time(sourceTime(p,p.end_ms))} s of ${time(clip.duration_ms)} s`;
        const video=this.root.querySelector('[data-source-preview]');if(video?.readyState>=1&&!d.edge)video.currentTime=p.source_in_ms/1000;
      }
    }catch(e){this.view.message(e.message,true);}
  }
  finishDrag(cancel=false){
    const d=this.drag;if(!d)return;this.drag=null;if(this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);this.root.classList.remove('fc-dragging');
    if(cancel||!d.changed){this.view.session=d.initial;this.view.dirty=d.dirty;}
    else{this.view.history.record(d.initial);this.view.dirty=true;this.suggestion=null;}
    this.view.renderEditor();
  }
}
