import { resizeSongSection, validateSession, snapToAudio } from '../../packages/composer-core/index.mjs';
import { MIN_REGION_MS } from '../../packages/composer-core/regions.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=ms=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(3).padStart(6,'0')}`;

/** Move a shared song-section boundary without moving the song or its clips. */
export class SectionEditor {
  constructor(view){
    this.view=view;this.root=view.root;
    this.guide=document.createElement('div');this.guide.className='fc-section-guide';this.guide.hidden=true;this.guide.innerHTML='<output></output>';
    this.root.querySelector('.fc-timeline').append(this.guide);
    this.root.addEventListener('pointerdown',event=>this.beginDrag(event));
    this.root.addEventListener('pointermove',event=>{if(this.drag?.pointer!==event.pointerId)return;event.preventDefault();this.drag.x=event.clientX;this.drag.alt=event.altKey;this.moveDrag();});
    this.root.addEventListener('pointerup',event=>{if(this.drag?.pointer===event.pointerId)this.finishDrag();});
    for(const name of ['pointercancel','lostpointercapture'])this.root.addEventListener(name,event=>{if(this.drag?.pointer===event.pointerId)this.finishDrag(true);});
    window.addEventListener('keydown',event=>this.keyDown(event),true);
    window.addEventListener('blur',()=>this.finishDrag(true));
  }
  renderHandles(){
    const v=this.view,s=v.session;if(!s)return;
    const strip=this.root.querySelector('.fc-section-strip');strip.querySelectorAll('.fc-section-handle').forEach(el=>el.remove());
    strip.insertAdjacentHTML('beforeend',s.sections.slice(0,-1).map((left,i)=>{
      const right=s.sections[i+1],locked=left.locked||right.locked,label=`Boundary between ${left.label} and ${right.label}`;
      return `<button class="fc-section-handle ${this.drag?.id===left.id?'fc-active':''}" data-section-boundary="${esc(left.id)}" style="left:${left.end_ms/s.song.duration_ms*100}%" role="separator" aria-orientation="vertical" aria-label="${esc(label)}" aria-valuemin="${(left.start_ms+MIN_REGION_MS)/1000}" aria-valuemax="${(right.end_ms-MIN_REGION_MS)/1000}" aria-valuenow="${left.end_ms/1000}" aria-valuetext="${stamp(left.end_ms)}" title="${esc(label)} · ${stamp(left.end_ms)}. ${locked?'Unlock both sections to move this boundary.':'Drag to resize. Alt bypasses snapping. Arrow keys: 100 ms; Shift: 1 s.'}" ${locked?'disabled':''}><span aria-hidden="true">⋮</span></button>`;
    }).join(''));
    if(this.drag)this.showGuide(s.sections.find(section=>section.id===this.drag.id).end_ms);
  }
  showGuide(at){this.guide.hidden=false;this.guide.style.left=`${at/this.view.session.song.duration_ms*100}%`;this.guide.querySelector('output').textContent=stamp(at);}
  boundary(session,id,at,snap){
    const index=session.sections.findIndex(s=>s.id===id),left=session.sections[index],right=session.sections[index+1];
    if(!left||!right)throw new Error('Choose a boundary between two song sections.');
    if(snap)at=snapToAudio(at,session.analysis);
    return Math.round(Math.max(left.start_ms+MIN_REGION_MS,Math.min(right.end_ms-MIN_REGION_MS,at)));
  }
  beginDrag(event){
    const handle=event.target.closest('[data-section-boundary]'),v=this.view;
    if(!handle||handle.disabled||event.button!==0||this.drag||v.regionEditor.drag||v.timeline.drag)return;
    const id=handle.dataset.sectionBoundary,index=v.session.sections.findIndex(s=>s.id===id),origin=v.session.sections[index].end_ms;
    event.preventDefault();v.invalidate();v.selected=index;v.selectedPlacement=null;v.inspectorMode='section';
    this.drag={id,initial:v.session,dirty:v.dirty,pointer:event.pointerId,x:event.clientX,alt:event.altKey,origin,offset:v.timeline.timeAt(event.clientX)-origin,changed:false};
    this.root.setPointerCapture(event.pointerId);this.root.classList.add('fc-dragging','fc-section-dragging');
    v.renderSections();v.renderInspector();v.draw();this.scrollFrame=requestAnimationFrame(()=>this.autoScroll());
  }
  moveDrag(){
    const d=this.drag;if(!d)return;const v=this.view;
    const at=this.boundary(d.initial,d.id,v.timeline.timeAt(d.x)-d.offset,this.root.querySelector('[data-field=snap-audio]').checked&&!d.alt);
    if(at===v.session.sections.find(s=>s.id===d.id).end_ms)return;
    try{
      const next=resizeSongSection(d.initial,d.id,at,v.catalog.clips);validateSession(next,v.catalog.clips);
      v.session=next;d.changed=at!==d.origin;v.renderSections();v.regionEditor.renderTrack();
      this.root.querySelector('[data-field=end_ms]').value=at/1000;
    }catch(e){v.message(e.message,true);}
  }
  autoScroll(){
    const d=this.drag;if(!d)return;
    const viewport=this.view.timeline.viewport,rect=viewport.getBoundingClientRect(),margin=36;
    const velocity=d.x<rect.left+margin?-Math.min(14,(rect.left+margin-d.x)/3):d.x>rect.right-margin?Math.min(14,(d.x-rect.right+margin)/3):0;
    const before=viewport.scrollLeft;viewport.scrollLeft+=velocity;
    if(viewport.scrollLeft!==before)this.moveDrag();
    this.scrollFrame=requestAnimationFrame(()=>this.autoScroll());
  }
  finishDrag(cancel=false){
    const d=this.drag;if(!d)return;this.drag=null;cancelAnimationFrame(this.scrollFrame);
    if(this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);
    this.root.classList.remove('fc-dragging','fc-section-dragging');this.guide.hidden=true;
    const v=this.view;
    if(cancel||!d.changed){v.session=d.initial;v.dirty=d.dirty;}
    else{v.history.record(d.initial);v.dirty=true;v.regionEditor.suggestion=null;v.message(`Section boundary moved to ${stamp(v.session.sections.find(s=>s.id===d.id).end_ms)}. Undo restores the previous timing.`);}
    v.renderEditor();this.focus(d.id);
  }
  focus(id){[...this.root.querySelectorAll('[data-section-boundary]')].find(el=>el.dataset.sectionBoundary===id)?.focus({preventScroll:true});}
  keyDown(event){
    if(event.key==='Escape'&&this.drag){event.preventDefault();event.stopPropagation();this.finishDrag(true);return;}
    const handle=event.target.closest('[data-section-boundary]');
    if(!handle||handle.disabled||this.drag||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const v=this.view,id=handle.dataset.sectionBoundary,index=v.session.sections.findIndex(s=>s.id===id),origin=v.session.sections[index].end_ms;
    const at=this.boundary(v.session,id,origin+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?1000:100),false);if(at===origin)return;
    try{const next=resizeSongSection(v.session,id,at,v.catalog.clips);v.selected=index;v.inspectorMode='section';v.regionEditor.commit(next);this.focus(id);}
    catch(e){v.message(e.message,true);}
  }
}
