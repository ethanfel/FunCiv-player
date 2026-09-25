import { createMusic, DEFAULT_MUSIC_SETTINGS, generateMusicBlock, replaceMusicRange, musicInput } from '../../packages/composer-core/music.mjs';
import { BEAT_CATALOG, beatShapeValue, beatGrid, beatClicksWav, savedBeatSelection, editBeatSections } from '../../vendor/motion-studio/audio-patterns.mjs';
import { analyzeBeatAudio, decodeBeatAudio } from '../../vendor/motion-studio/audio-analysis.mjs';
import { evaluate } from '../../vendor/motion-studio/curve.mjs';
import { rulerInterval } from './timeline-viewport.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=ms=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(1).padStart(4,'0')}`;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export class MusicEditor {
  constructor(view){
    this.view=view;this.root=view.root.querySelector('.fc-music-editor');this.$=s=>this.root.querySelector(s);
    this.canvas=this.$('canvas');this.scroll=this.$('.fc-music-scroll');this.track=this.$('.fc-music-track');this.audio=this.$('[data-music-audition]');
    this.start=0;this.end=0;this.zoom=1;this.settings={...DEFAULT_MUSIC_SETTINGS};this.active=false;this.generation=0;
    this.$('[data-music-sound]').value='auto';
    this.root.addEventListener('click',event=>{
      const button=event.target.closest('[data-music-action]');if(!button)return;
      event.stopPropagation();void this.action(button.dataset.musicAction,button).catch(error=>this.message(error.message,true));
    });
    this.root.addEventListener('change',event=>{
      if(event.target.dataset.action||event.target.dataset.field)return;
      event.stopPropagation();void this.change(event.target).catch(error=>{this.message(error.message,true);this.render();});
    });
    this.scroll.addEventListener('scroll',()=>this.draw(),{passive:true});
    this.scroll.addEventListener('wheel',event=>{
      if(event.ctrlKey||event.metaKey){event.preventDefault();this.setZoom(this.zoom*Math.exp(-event.deltaY*.004),event.clientX-this.scroll.getBoundingClientRect().left);}
      else if(event.shiftKey){event.preventDefault();this.scroll.scrollLeft+=event.deltaY||event.deltaX;}
    },{passive:false});
    this.scroll.addEventListener('pointerdown',event=>this.pointerDown(event));
    this.scroll.addEventListener('pointermove',event=>this.pointerMove(event));
    this.scroll.addEventListener('pointerup',()=>this.finishDrag());
    this.scroll.addEventListener('pointercancel',()=>this.finishDrag(true));
    this.scroll.addEventListener('lostpointercapture',()=>this.finishDrag(true));
    this.root.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&this.drag){event.preventDefault();this.finishDrag(true);}
      const edge=event.target.dataset.musicEdge;
      if(edge&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const delta=(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?1000:100);this.setRange(edge==='start'?this.start+delta:this.start,edge==='end'?this.end+delta:this.end);}
    });
    view.root.ownerDocument.defaultView.addEventListener('blur',()=>this.finishDrag(true));
    view.player.audio.addEventListener('play',()=>this.stopAudition());
    this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(this.scroll);
    this.render();
  }
  message(text,error=false){this.$('.fc-music-status').textContent=text;this.$('.fc-music-status').classList.toggle('fc-error',error);}
  open(active){
    this.active=active;this.root.hidden=!active;this.view.root.classList.toggle('fc-music-mode',active);
    this.view.root.querySelector('#fc-arrangement-panel').hidden=active;
    for(const [name,selected] of [['music',active],['arrangement',!active]]){
      const tab=this.view.root.querySelector(`#fc-${name}-tab`);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
    }
    if(!active)this.hide();this.render();this.view.draw();
  }
  hide(){this.stopAudition();this.finishDrag(true);this.generation++;}
  discard(){this.draft=null;this.stopAudition();}
  setRange(start,end){
    const duration=this.view.session?.song.duration_ms||0;if(!duration)return;
    this.start=clamp(Math.round(start),0,duration-1);this.end=clamp(Math.round(end),this.start+1,duration);
    this.selected=null;this.discard();this.render();
  }
  readSettings(){
    const value={...this.settings};
    for(const el of this.root.querySelectorAll('[data-music-setting]')){
      const key=el.dataset.musicSetting;value[key]=el.type==='checkbox'?el.checked:typeof DEFAULT_MUSIC_SETTINGS[key]==='number'?Number(el.value):el.value;
    }
    value.amplitude=Number(this.$('[data-music-stroke]').value)/2;value.association=this.$('[data-music-mix]').checked?'dual':'beats';
    if(value.rhythm!=='original')value.beatsPerCycle=1;
    return value;
  }
  async change(input){
    const v=this.view;if(!v.session)return;
    if(input.matches('[data-music-source-select]')){
      const track=(v.catalog.beats||[]).find(t=>t.id===input.value)||(v.session.music?.beat_track?.id===input.value?v.session.music.beat_track:null);await this.useTrack(track);return;
    }
    if(input.matches('[data-music-offset]')){
      const offset=Number(input.value);this.discard();
      v.edit(s=>{s.music??=createMusic();s.music.offset_ms=offset;},{keepPlacements:true});
      this.message('Beat alignment changed. Saved blocks keep their timing; regenerate the ranges you want to update.');return;
    }
    if(input.dataset.musicBound){this.setRange(input.dataset.musicBound==='start'?Number(input.value)*1000:this.start,input.dataset.musicBound==='end'?Number(input.value)*1000:this.end);return;}
    if(input.matches('[data-music-section]')){
      const section=v.session.sections.find(s=>s.id===input.value);if(section)this.setRange(section.start_ms,section.end_ms);return;
    }
    if(input.matches('[data-music-sound]')){this.stopAudition();return;}
    this.settings=this.readSettings();this.discard();this.render();
  }
  async useTrack(track){
    if(this.view.busy)throw new Error('Wait for the current task or cancel it.');
    const v=this.view;
    if(track){
      if(track.id===v.session.music?.beat_track?.id&&v.session.music.analysis)return;
      await this.analyzeBeat(track);return;
    }
    this.discard();
    v.edit(s=>{s.music??=createMusic();s.music.beat_track=null;s.music.analysis=null;s.music.offset_ms=0;},{keepPlacements:true});
    this.message('The main song is the beat source. Saved blocks stay unchanged until regenerated.');
  }
  async analyzeBeat(track=this.view.session.music?.beat_track){
    const v=this.view;
    if(!track){await v.analyze();this.render();return;}
    if(v.busy)throw new Error('Wait for the current task or cancel it.');
    const session=v.session.id,previous=v.session.music?.beat_track?.id,token=++v.analysisGeneration,owner=++this.generation;
    const cancelled=()=>token!==v.analysisGeneration||owner!==this.generation||v.session?.id!==session||v.session.music?.beat_track?.id!==previous||!v.visible;
    const bar=v.root.querySelector('progress'),cancel=v.root.querySelector('[data-action=cancel]');
    v.busy=true;this.pendingTrack=track;bar.value=0;bar.hidden=false;cancel.hidden=false;this.render();this.message(`Analyzing ${track.name}… Previous timing stays active until this finishes.`);
    try{
      const response=await fetch(track.url);if(!response.ok)throw new Error('Beat audio is unavailable. Import it again.');
      const {samples,sampleRate}=await decodeBeatAudio(await response.blob());
      const analysis=await analyzeBeatAudio(samples,sampleRate,{cancelled,progress:value=>{bar.value=value;}});
      if(cancelled()){this.message('Beat analysis cancelled. Previous timing and saved blocks are unchanged.');return;}
      v.edit(s=>{s.music??=createMusic();s.music.beat_track=track;s.music.analysis=analysis;if(previous!==track.id)s.music.offset_ms=0;},{keepPlacements:true});
      this.settings.bpm=analysis.bpm>=30&&analysis.bpm<=300?analysis.bpm:120;
      this.message(`Beat source ready · ${analysis.onsets.length} attacks · ${analysis.bpm||'unknown'} BPM. Generate a preview for the selected range.`);
    }catch(error){
      if(cancelled()){this.message('Beat analysis cancelled. Previous timing and saved blocks are unchanged.');return;}
      throw new Error(`Could not analyze ${track.name}: ${error.message} Previous timing and saved blocks are unchanged.`);
    }finally{this.pendingTrack=null;v.busy=false;bar.hidden=true;cancel.hidden=true;this.render();v.schedulePreviewRefresh();}
  }
  async action(action,button){
    const v=this.view,s=v.session;if(!s)throw new Error('Load a main song first.');
    if(action==='undo'||action==='redo'){await v.action(action);return;}
    if(action==='analyze-main'){await v.analyze();this.render();return;}
    if(action==='import'){
      const id=s.id,token=++this.generation,track=await v.job('beat-audio');
      if(track&&v.session?.id===id&&token===this.generation&&v.visible)await this.useTrack(track);return;
    }
    if(action==='analyze'){await this.analyzeBeat();return;}
    if(action==='arrangement'){this.open(false);return;}
    if(action==='whole'){this.setRange(0,s.song.duration_ms);return;}
    if(action==='mark-in'||action==='mark-out'){this.setRange(action==='mark-in'?v.position:this.start,action==='mark-out'?v.position:this.end);return;}
    if(action==='zoom-in'||action==='zoom-out'){this.setZoom(this.zoom*(action==='zoom-in'?1.5:1/1.5));return;}
    if(action==='fit'){this.setZoom(1,0);this.scroll.scrollLeft=0;return;}
    if(action==='fit-range'){this.setZoom(s.song.duration_ms/((this.end-this.start)*1.1),0);this.scroll.scrollLeft=Math.max(0,this.start/s.song.duration_ms*this.width()-(this.scroll.clientWidth*.05));return;}
    if(action==='pattern'){this.settings={...this.readSettings(),mode:'manual',shape:button.dataset.shape};this.discard();this.render();return;}
    if(action==='select'){this.selectBlock(button.dataset.id);return;}
    if(action==='discard'){this.discard();this.message('Preview discarded. Saved beat blocks are unchanged.');this.render();return;}
    if(action==='generate'||action==='variation'){
      this.settings=this.readSettings();if(action==='variation'){this.settings.mode='random';this.settings.seed=(this.settings.seed+1)>>>0;}
      this.stopAudition();this.draft=generateMusicBlock(s,this.start,this.end,this.settings);
      this.message(this.draft.summary+' · Preview only. Click Apply to arrangement to save it.');this.render();return;
    }
    if(action==='apply'){
      if(!this.draft)throw new Error('Generate a preview first.');
      const draft=this.draft;this.discard();
      v.edit(next=>{next.music=replaceMusicRange(next,draft.start,draft.end,draft);},{keepPlacements:true});
      this.message('Applied to the arrangement. Audio sync clips, Follow song sections and marked audio gaps now use this curve. Open Video arrangement to see it; prepare the preview for the combined motion.');return;
    }
    if(action==='remove'){
      this.discard();v.edit(next=>{
        const music=next.music;if(!music)return;
        // Delete each intersection, retaining the saved fragments outside it.
        for(const block of [...music.blocks])if(block.start<this.end&&block.end>this.start)
          music.blocks=editBeatSections(music.blocks,block.id,Math.max(this.start,block.start),Math.min(this.end,block.end)).sections;
      },{keepPlacements:true});this.message('Saved audio removed from this range. Automatic generation fills it again.');return;
    }
    if(action==='stop-audition'){this.stopAudition();return;}
    if(action==='listen'||action==='download'){
      const block=this.draft||savedBeatSelection(s.music?.blocks||[],this.start,this.end);
      if(!block?.events?.length)throw new Error('Generate a preview with timing hits, or select a saved block first.');
      const blob=new Blob([beatClicksWav(block.events,this.start,this.end,{sound:this.$('[data-music-sound]').value})],{type:'audio/wav'});
      if(action==='download'){
        const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`rhythm-${this.start}-${this.end}.wav`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
      }
      this.stopAudition();v.player.pause();this.auditionURL=URL.createObjectURL(blob);this.audio.src=this.auditionURL;this.audio.hidden=false;
      this.$('[data-music-action=stop-audition]').disabled=false;
      try{await this.audio.play();}catch(error){this.stopAudition();throw error;}
    }
  }
  stopAudition(){
    this.audio.pause();this.audio.removeAttribute('src');this.audio.hidden=true;
    if(this.auditionURL)URL.revokeObjectURL(this.auditionURL);this.auditionURL=null;
    this.$('[data-music-action=stop-audition]').disabled=true;
  }
  selectBlock(id){
    const block=this.view.session?.music?.blocks.find(b=>b.id===id);if(!block)return;
    this.setRange(block.start,block.end);this.selected=id;this.settings={...DEFAULT_MUSIC_SETTINGS,...block.settings};this.render();
    this.message(block.summary||'Saved beat block selected. Change the settings and generate a replacement.');
  }
  render(){
    const s=this.view.session,music=s?.music;
    if(this.sessionId!==s?.id){this.sessionId=s?.id;this.start=0;this.end=s?.song.duration_ms||0;this.settings={...DEFAULT_MUSIC_SETTINGS,...music?.settings};this.zoom=1;this.discard();this.selected=null;}
    // Undo/reopen/source analysis changes invalidate any unsaved preview.
    if(this.lastMusic!==music||this.lastAnalysis!==s?.analysis){this.discard();this.lastMusic=music;this.lastAnalysis=s?.analysis;}
    this.$('[data-music-main]').textContent=s?.song.name||'No song loaded';
    this.$('[data-music-main-status]').textContent=s?.analysis?`${s.analysis.bpm||'Unknown'} BPM · Main-song energy analyzed`:'Analyze the main song for its waveform and energy.';
    this.$('[data-music-source]').textContent=music?.beat_track?.name||'Using the main song';
    const analysis=music?.beat_track?music.analysis:s?.analysis;
    this.$('[data-music-source-status]').textContent=this.pendingTrack?`Analyzing ${this.pendingTrack.name}…`:analysis?`${analysis.onsets.length} attacks · ${analysis.bpm||'unknown'} BPM · ${Math.round((analysis.confidence||0)*100)}% tempo confidence`:music?.beat_track?'Beat track imported · click Analyze beat source':'Analyze the main song, or import a drums stem.';
    this.$('[data-music-source-select]').innerHTML='<option value="">Main song</option>'+(this.view.catalog.beats||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)} · ${stamp(t.duration_ms)}</option>`).join('');
    if(music?.beat_track&&!(this.view.catalog.beats||[]).some(t=>t.id===music.beat_track.id))this.$('[data-music-source-select]').insertAdjacentHTML('beforeend',`<option value="${esc(music.beat_track.id)}">${esc(music.beat_track.name)} (saved)</option>`);
    this.$('[data-music-source-select]').value=this.pendingTrack?.id||music?.beat_track?.id||'';this.$('[data-music-offset]').value=music?.offset_ms||0;
    for(const [key,value] of Object.entries(this.settings)){const input=this.$(`[data-music-setting="${key}"]`);if(input){if(input.type==='checkbox')input.checked=value;else input.value=value;}}
    this.$('[data-music-stroke]').value=this.settings.amplitude*2;this.$('[data-music-mix]').checked=this.settings.association==='dual';
    this.$('[data-music-bound=start]').value=this.start/1000;this.$('[data-music-bound=end]').value=this.end/1000;
    this.$('[data-music-section]').innerHTML='<option value="">Select a section…</option>'+(s?.sections||[]).map(section=>`<option value="${esc(section.id)}">${esc(section.label)} · ${stamp(section.start_ms)}–${stamp(section.end_ms)}</option>`).join('');
    this.$('[data-music-section]').value=s?.sections.find(section=>section.start_ms===this.start&&section.end_ms===this.end)?.id||'';
    const busy=this.view.busy;
    for(const el of this.root.querySelectorAll('input,select,button'))el.disabled=!s||busy;
    const disable=(selector,value)=>{this.$(selector).disabled=!s||busy||value;};
    disable('[data-music-action=apply]',!this.draft);disable('[data-music-action=discard]',!this.draft);
    disable('[data-music-action=remove]',!(music?.blocks||[]).some(b=>b.start<this.end&&b.end>this.start));
    disable('[data-music-action=generate]',!analysis);disable('[data-music-action=variation]',!analysis);
    disable('[data-music-setting=shape]',this.settings.mode!=='manual');disable('[data-music-setting=seed]',this.settings.mode!=='random');
    disable('[data-music-setting=bpm]',this.settings.timing!=='tempo');disable('[data-music-setting=beatsPerCycle]',this.settings.rhythm!=='original');
    for(const key of ['density','lowFocus','maxHitsPerSecond','preserveSyncopation'])disable(`[data-music-setting=${key}]`,this.settings.rhythm==='original');
    const saved=s?savedBeatSelection(music?.blocks||[],this.start,this.end):null,show=this.draft||saved;
    disable('[data-music-action=listen]',!show?.events?.length);disable('[data-music-action=download]',!show?.events?.length);disable('[data-music-action=stop-audition]',!this.auditionURL);
    this.$('[data-music-rhythm-help]').textContent=({simplify:'Keeps the pulse and strong accents; weak or crowded hits are filtered.',accents:'Keeps prominent measured attacks, including offbeat hits.',steady:'Reconstructs a steady pulse through local tempo changes.',original:'Uses the selected timing directly, with adjustable beats per cycle.'})[this.settings.rhythm]+' Max hits / second controls event spacing.';
    this.$('[data-music-decisions]').innerHTML=show?.decisions?.length?show.decisions.map(d=>`<p><strong>${stamp(d.start)}–${stamp(d.end)} · ${esc(d.shape)}</strong><br>${esc(d.reason)}${d.alternatives?.length?'<br>Alternatives: '+d.alternatives.map(a=>esc(a.shape)+' '+a.match+'%').join(', '):''}</p>`).join(''):'Generate a preview to see the pattern choices.';
    this.$('[data-music-blocks]').innerHTML=(music?.blocks||[]).map(b=>`<button data-music-action="select" data-id="${esc(b.id)}" aria-pressed="${b.id===this.selected}"><strong>${stamp(b.start)}–${stamp(b.end)}</strong><span>${esc(b.summary||b.settings.shape)}</span></button>`).join('')||'No saved blocks yet.';
    this.renderCatalogue();
    for(const button of this.root.querySelectorAll('[data-music-action=pattern]'))button.disabled=!s||busy;
    this.draw();
  }
  renderCatalogue(){
    const key=JSON.stringify([this.settings.patternFamily,this.settings.shape,this.settings.mode,this.settings.beatLanding]);if(key===this.catalogueKey)return;this.catalogueKey=key;
    this.$('.fc-music-patterns').innerHTML=BEAT_CATALOG.filter(p=>this.settings.patternFamily==='all'||p.family===this.settings.patternFamily).map(p=>{
      const points=Array.from({length:65},(_,i)=>`${i*2},${25-beatShapeValue(p.name,i/64,this.settings.beatLanding)*20}`).join(' ');
      return `<button data-music-action="pattern" data-shape="${p.name}" aria-pressed="${this.settings.mode==='manual'&&this.settings.shape===p.name}" title="${p.description}"><svg viewBox="0 0 128 50" aria-hidden="true"><polyline points="${points}"/></svg><strong>${p.name}</strong><small>${p.family}</small></button>`;
    }).join('');
  }
  width(){return this.scroll.clientWidth*this.zoom;}
  setZoom(zoom,anchor=this.scroll.clientWidth/2){
    const previous=this.zoom;this.zoom=clamp(zoom,1,128);this.track.style.width=`${this.width()}px`;
    this.scroll.scrollLeft=(this.scroll.scrollLeft+anchor)/previous*this.zoom-anchor;this.draw();
  }
  timeAt(clientX){return Math.round(clamp((clientX-this.scroll.getBoundingClientRect().left+this.scroll.scrollLeft)/this.width(),0,1)*(this.view.session?.song.duration_ms||0));}
  pointerDown(event){
    if(event.button!==0||!this.view.session)return;
    const at=this.timeAt(event.clientX),edge=event.target.dataset.musicEdge,y=event.clientY-this.canvas.getBoundingClientRect().top;
    if(!edge&&!event.shiftKey&&y>=172&&y<210){const block=this.view.session.music?.blocks.find(b=>b.start<=at&&b.end>at);if(block){this.selectBlock(block.id);return;}}
    event.preventDefault();this.drag={id:event.pointerId,edge,range:event.shiftKey,start:this.start,end:this.end,at};this.scroll.setPointerCapture(event.pointerId);
    if(!edge&&!event.shiftKey)this.view.setPosition(at);
  }
  pointerMove(event){
    const d=this.drag;if(!d||d.id!==event.pointerId)return;
    const rect=this.scroll.getBoundingClientRect();if(event.clientX<rect.left+20)this.scroll.scrollLeft-=15;if(event.clientX>rect.right-20)this.scroll.scrollLeft+=15;
    const at=this.timeAt(event.clientX);
    if(d.edge)this.setRange(d.edge==='start'?Math.min(at,d.end-1):d.start,d.edge==='end'?Math.max(d.start+1,at):d.end);
    else if(d.range)this.setRange(Math.min(at,d.at),Math.max(at,d.at));else this.view.setPosition(at);
  }
  finishDrag(cancel=false){
    const d=this.drag;if(!d)return;this.drag=null;
    if(this.scroll.hasPointerCapture(d.id))this.scroll.releasePointerCapture(d.id);
    if(cancel&&(d.edge||d.range))this.setRange(d.start,d.end);
  }
  tick(time){
    const duration=this.view.session?.song.duration_ms||1;
    this.$('.fc-music-cursor').style.left=`${Math.min(100,time/duration*100)}%`;
  }
  draw(){
    if(!this.active||!this.view.session)return;
    const s=this.view.session,width=this.scroll.clientWidth;if(!width)return;
    const duration=s.song.duration_ms,total=this.width(),left=this.scroll.scrollLeft,start=left/total*duration,perPixel=duration/total,dpr=Math.min(window.devicePixelRatio||1,2);
    this.track.style.width=`${total}px`;this.canvas.style.width=`${width}px`;this.canvas.width=Math.round(width*dpr);this.canvas.height=360*dpr;
    const ctx=this.canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle='#111b2b';ctx.fillRect(0,0,width,360);
    const step=rulerInterval(perPixel),x=at=>(at-start)/perPixel;
    ctx.font='11px system-ui';
    for(let at=Math.ceil(start/step)*step;at<=Math.min(duration,start+width*perPixel);at+=step){ctx.strokeStyle='#2b374b';ctx.beginPath();ctx.moveTo(x(at),23);ctx.lineTo(x(at),360);ctx.stroke();ctx.fillStyle='#a6b7d0';ctx.fillText(stamp(at),x(at)+4,16);}
    const wave=(analysis,offset,y,color)=>{
      ctx.strokeStyle=color;ctx.beginPath();
      if(analysis?.waveform?.length)for(let px=0;px<width;px++){
        const t=start+px*perPixel-offset;if(t<0||t>=analysis.duration_ms)continue;
        const lo=Math.floor(t/analysis.duration_ms*analysis.waveform.length),hi=Math.max(lo+1,Math.ceil((t+perPixel)/analysis.duration_ms*analysis.waveform.length));let peak=0;
        for(let i=lo;i<Math.min(hi,analysis.waveform.length);i++)peak=Math.max(peak,analysis.waveform[i]);
        ctx.moveTo(px,y-peak*22);ctx.lineTo(px,y+peak*22);
      }ctx.stroke();
    };
    wave(s.analysis,0,66,'#c0a5f8');const analysis=s.music?.beat_track?s.music.analysis:s.analysis;wave(analysis,s.music?.offset_ms||0,132,'#75d5ed');
    if(!analysis){ctx.fillStyle='#a8b8d2';ctx.fillText(this.pendingTrack?'Analyzing beat source…':'No timing analysis yet · Analyze beat source above',12,136);}
    const gridKey=JSON.stringify([s.music?.offset_ms||0,this.settings]);
    if(this.gridAnalysis!==analysis||this.gridKey!==gridKey){
      this.gridAnalysis=analysis;this.gridKey=gridKey;
      try{this.grid=beatGrid(musicInput(s),this.settings);}catch{this.grid=[];}
    }
    const events=this.draft?.events||this.grid||[];
    ctx.strokeStyle='#e3bd70';ctx.beginPath();for(const p of events)if(p.at>=start&&p.at<=start+width*perPixel){ctx.moveTo(x(p.at),151);ctx.lineTo(x(p.at),166);}ctx.stroke();
    for(const b of s.music?.blocks||[]){const a=Math.max(0,x(b.start)),w=Math.min(width,x(b.end))-a;if(w<=0)continue;ctx.fillStyle=b.id===this.selected?'#6e5999':'#3d3457';ctx.fillRect(a,177,w,28);ctx.save();ctx.beginPath();ctx.rect(a,177,w,28);ctx.clip();ctx.fillStyle='#e0d7f2';ctx.fillText(b.settings.mode==='manual'?b.settings.shape:'Beat block',a+7,195);ctx.restore();}
    if(!s.music?.blocks?.length){ctx.fillStyle='#a8b8d2';ctx.fillText('Generate preview → Apply to arrangement',12,196);}
    ctx.strokeStyle='#47536d';ctx.beginPath();ctx.moveTo(0,287);ctx.lineTo(width,287);ctx.stroke();
    const curve=(actions,a,b,color,dashed=false)=>{
      ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash(dashed?[5,4]:[]);ctx.beginPath();let first=true;
      const lo=Math.max(0,Math.floor(x(a))),hi=Math.min(width,Math.ceil(x(b)));for(let px=lo;px<=hi;px++){
        const y=339-evaluate(actions,clamp(start+px*perPixel,a,b))*1.04;if(first){ctx.moveTo(px,y);first=false;}else ctx.lineTo(px,y);
      }ctx.stroke();ctx.setLineDash([]);ctx.lineWidth=1;
    };
    for(const b of s.music?.blocks||[])curve(b.actions,b.start,b.end,'#bba4ff');
    if(this.draft)curve(this.draft.actions,this.draft.start,this.draft.end,'#f69fcf',true);
    for(const [text,y] of [['MAIN SONG · energy',37],['DRUMS / BEATS · timing',105],['SAVED BEAT BLOCKS',173],['SCRIPT · purple saved / pink preview',225]]){ctx.fillStyle='#111b2bdd';ctx.fillRect(5,y-11,255,16);ctx.fillStyle='#a8b8d2';ctx.fillText(text,9,y);}
    const range=this.$('.fc-music-range');range.style.left=`${this.start/duration*100}%`;range.style.width=`${(this.end-this.start)/duration*100}%`;
    this.$('[data-music-zoom]').textContent=`${this.zoom.toFixed(this.zoom===1?0:1)}×`;this.tick(this.view.position||0);
  }
}
