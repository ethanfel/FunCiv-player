import { createSession, arrange, validateSession, clipRating, History, clone, DEFAULT_OUTPUT, OUTPUT_PRESETS, outputSettings, sectionCategories, splitSongSection, mergeSongSections, resizeSongSection } from '../../packages/composer-core/index.mjs';
import { analyzeBeatAudio, decodeBeatAudio } from '../../vendor/motion-studio/audio-analysis.mjs';
import { evaluate } from '../../vendor/motion-studio/curve.mjs';
import { CompositionPlayer } from './composition-player.js';
import { ComposerDeviceSession } from './device-session.js';
import { RegionEditor, REGION_TOOLS } from './region-editor.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=ms=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(1).padStart(4,'0')}`;
const options=(values,selected)=>values.map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');
const policies=[['clip','Clip motion'],['song','Follow song'],['gaps','Clip + marked gaps'],['hold','Neutral hold']];
const ratingLabel=rating=>rating ? `${rating}★` : 'Unrated';
const ready=clip=>clip.available&&clip.script_ready;

export class ComposerView {
  constructor(app,root){
    this.app=app;this.root=root;this.history=new History();this.catalog={clips:[],songs:[]};this.saved=[];this.revisions=new Map();
    this.devices=new ComposerDeviceSession(app);this.analysisGeneration=0;this.preparationGeneration=0;this.selected=0;this.dirty=false;this.defaultMinRating=0;
    this.root.innerHTML=`
      <header class="fc-header"><div><span class="fc-eyebrow">FUNCIV / COMPOSER</span><h1>Make a session from a song.</h1></div>
        <div class="fc-actions"><select data-field="saved" aria-label="Saved sessions"><option value="">Open session…</option></select><button data-action="save">Save session</button><button data-action="import" class="fc-primary">＋ Load song</button></div></header>
      <div class="fc-status" role="status" aria-live="polite"><span data-status>Load a song and add a folder of clips to begin.</span><progress hidden max="1"></progress><button data-action="cancel" hidden>Cancel</button></div>
      <div class="fc-workspace">
        <aside class="fc-library"><div class="fc-panel-heading"><h2>Clip library</h2><button data-action="scan">＋ Folder</button></div>
          <div class="fc-library-tools"><button data-action="dataset">Sync FunCiv Data</button><button data-action="credentials">API settings</button></div>
          <label class="fc-search">Find clips<input data-field="search" type="search" placeholder="Name or category…"></label>
          <label>Show<select data-field="library-view"><option value="all">All catalog</option><option value="ready">Ready with motion</option><option value="local">Local videos</option><option value="used">Used in session</option></select></label>
          <label>Minimum rating for session<select data-field="min_rating">${options([[0,'All ratings (including unrated)'],[1,'1★ or higher'],[2,'2★ or higher'],[3,'3★ or higher'],[4,'4★ or higher'],[5,'5★ only']].map(([n,label])=>[String(n),label]),'0')}</select></label>
          <small>Applies to assembly, preview and export.</small>
          <label>Sort clips<select data-field="library-sort"><option value="rating">Rating: highest first</option><option value="name">Name: A–Z</option></select></label>
          <label class="fc-check"><input data-field="drafts" type="checkbox"> Include draft scripts</label>
          <div class="fc-rating-warning" role="status" hidden></div>
          <div class="fc-library-count"></div><div class="fc-clips"></div>
        </aside>
        <main class="fc-main">
          <div class="fc-songbar"><div class="fc-song-title">No song loaded</div><div class="fc-actions"><select data-field="song" aria-label="Previously imported songs"><option value="">Recent songs…</option></select><button data-action="analyze">Analyze song</button></div></div>
          <div class="fc-output-settings"><label>Output format<select data-field="output-preset">${options(OUTPUT_PRESETS.map(p=>[p.id,p.label]),DEFAULT_OUTPUT.preset)}</select></label><label>Scaling<select data-field="output-fit">${options([['cover','Fill frame (center crop)'],['contain','Fit frame (black bars)']],DEFAULT_OUTPUT.fit)}</select></label><small>30 fps · preview matches export framing</small></div>
          <div class="fc-preview-stage"><div class="fc-preview"><video muted playsinline preload="auto" hidden></video><video muted playsinline preload="auto" hidden></video><div class="fc-preview-empty">Your assembled session appears here.<br><small>The song sets the pace. Clips bring the motion.</small></div><span class="fc-preview-label">PREVIEW · DEVICES OFF</span></div></div>
          <audio preload="auto"></audio>
          <div class="fc-transport"><button data-action="play" aria-label="Play or pause preview">▶ Play</button><button data-action="stop">Stop</button><output class="fc-time">0:00.0</output><input data-field="seek" type="range" min="0" max="1" value="0" step="1" aria-label="Session position"><label>Volume<input data-field="volume" type="range" min="0" max="1" value="0.7" step="0.05"></label></div>
          ${REGION_TOOLS}
          <div class="fc-timeline-viewport"><div class="fc-timeline"><div class="fc-audio-markers"></div><canvas class="fc-wave" height="64" aria-label="Song energy waveform"></canvas><div class="fc-track-label">Sections · folder category pools</div><div class="fc-section-strip"></div><div class="fc-track-label">Clip regions · drag edges to change timing</div><div class="fc-placement-strip"></div><canvas class="fc-motion" height="68" aria-label="Compiled motion curve"></canvas><div class="fc-playhead"></div></div></div>
          <div class="fc-editbar"><button data-action="undo">↶ Undo</button><button data-action="redo">↷ Redo</button><button data-action="split">Split section</button><button data-action="merge">Merge next section</button><span class="fc-spacer"></span><button data-action="assemble" class="fc-primary">Assemble</button><button data-action="variation">New variation</button></div>
          <div class="fc-sections"></div>
          <div class="fc-footer"><div class="fc-summary">Choose a song to build your timeline.</div><div class="fc-actions"><button data-action="prepare">Prepare preview</button><button data-action="devices">Prepare device sync</button><button data-action="render" class="fc-primary">Render temporary video</button></div></div>
          <div class="fc-render" hidden></div>
        </main>
        <aside class="fc-inspector"><h2>Section settings</h2><div class="fc-inspector-tabs"><button data-action="inspector-section">Section</button><button data-action="inspector-clip" disabled>Clip region</button></div><div class="fc-inspector-content">Select a section to edit its category and motion.</div><div class="fc-session-settings"></div></aside>
      </div>`;
    this.player=new CompositionPlayer(this.root.querySelector('audio'),[...this.root.querySelectorAll('video')],time=>this.tick(time),message=>this.message(message,true));
    this.player.audio.volume=.7;
    this.root.addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(button){void this.action(button.dataset.action,button).catch(e=>this.message(e.message,true));return;}
      const section=event.target.closest('[data-section]');if(section){this.selected=Number(section.dataset.section);this.inspectorMode='section';this.selectedPlacement=this.session?.placements.find(p=>p.section_id===this.session.sections[this.selected].id)?.id;this.renderEditor();}
      const placement=event.target.closest('button[data-placement]');if(placement)this.regionEditor.select(placement.dataset.placement);
    });
    this.root.addEventListener('change',event=>{void this.change(event.target).catch(e=>{this.message(e.message,true);this.renderEditor();});});
    this.root.querySelector('[data-field=search]').addEventListener('input',()=>this.renderLibrary());
    this.root.addEventListener('keydown',event=>{if(event.code==='Space'&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(event.target.tagName)){event.preventDefault();event.stopPropagation();void this.action('play').catch(e=>this.message(e.message,true));}});
    for(const canvas of this.root.querySelectorAll('canvas'))canvas.addEventListener('click',event=>{
      if(!this.session)return;const rect=canvas.getBoundingClientRect();this.setPosition((event.clientX-rect.left)/rect.width*this.session.song.duration_ms);
    });
    this.resizeObserver=new ResizeObserver(()=>this.draw());this.resizeObserver.observe(this.root);
    this.regionEditor=new RegionEditor(this);
    this.renderOutput();
    window.addEventListener('beforeunload',event=>{if(this.dirty){event.preventDefault();event.returnValue='';}});
  }
  ipc(action,payload){return window.funsync.composer(action,payload);}
  async show(){this.visible=true;await this.refresh();this.renderEditor();}
  hide(){this.visible=false;this.regionEditor.finishDrag(true);this.regionEditor.pauseSource();this.player.pause();this.devices.release();this.analysisGeneration++;this.tick(this.position||0);}
  message(text,error=false){const box=this.root.querySelector('.fc-status');box.classList.toggle('fc-error',error);box.querySelector('[data-status]').textContent=text;}
  async refresh(){
    this.catalog=await this.ipc('state');if(this.ratingConflicts().length)this.invalidate();this.saved=await this.ipc('sessions');
    this.root.querySelector('[data-field=saved]').innerHTML='<option value="">Open session…</option>'+options(this.saved.map(s=>[s.id,s.name]),'');
    this.root.querySelector('[data-field=song]').innerHTML='<option value="">Recent songs…</option>'+options(this.catalog.songs.map(s=>[s.id,s.name]),'');
    this.renderLibrary();
  }
  async job(action,payload){
    if(this.busy)throw new Error('Wait for the current task or cancel it.');
    this.busy=true;const progress=this.root.querySelector('progress'),cancel=this.root.querySelector('[data-action=cancel]');
    try{
      const job=await this.ipc(action,payload);if(!job)return null;
      this.jobId=job.id;progress.hidden=false;cancel.hidden=false;
      while(true){const state=await this.ipc('job',{id:job.id});progress.value=state.progress;this.message(state.message);
        if(state.state==='completed'){await this.refresh();return state.result;}
        if(state.state!=='running')throw new Error(state.error||'Task cancelled.');
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    }finally{this.busy=false;this.jobId=null;progress.hidden=true;cancel.hidden=true;}
  }
  invalidate(){this.preparationGeneration++;this.regionEditor?.pauseSource();this.player.pause();this.player.snapshot=null;this.devices.release();this.prepared=null;this.root.querySelector('.fc-preview-label').textContent='PREVIEW · NEEDS PREPARATION';}
  edit(fn,{keepPlacements=false}={}){
    if(!this.session)throw new Error('Load a song first.');
    const next=clone(this.session);fn(next);if(!keepPlacements){next.placements=[];next.sections.forEach(s=>{s.locked=false;s.planned_regions=false;});delete next.asset_bindings;}
    validateSession(next);this.history.record(this.session);this.invalidate();this.session=next;this.dirty=true;this.renderEditor();
  }
  newSong(song){
    this.analysisGeneration++;this.invalidate();const minimum=this.minimumRating();this.session=createSession(song);this.session.min_rating=minimum;this.selected=0;this.selectedPlacement=null;this.history=new History();this.dirty=true;this.position=0;this.renderEditor();this.message('Song ready. Analyze it, choose categories, then assemble.');
  }
  discardOkay(){return !this.dirty||window.confirm('Leave this session without saving your changes?');}
  async action(action,button){
    if(await this.regionEditor.action(action,button))return;
    if(action==='cancel'){this.analysisGeneration++;if(this.jobId)await this.ipc('cancel',{id:this.jobId});return;}
    if(action==='scan'){const result=await this.job('scan');if(result)this.message(`${result.count} clips indexed.${result.warnings.length?' '+result.warnings.slice(0,3).join(' · '):''}`);return;}
    if(action==='dataset'){const result=await this.job('dataset');if(result)this.message(`${result.count} script variants indexed. Resolve a selected clip before assembly.`);return;}
    if(action==='resolve'){await this.job('resolve',{id:button.dataset.id,site:this.site||'civitai.com'});this.message('Video and verified scripts are ready. Binding checked by duration; preview before use.');return;}
    if(action==='credentials'){this.credentials();return;}
    if(action==='inspector-section'||action==='inspector-clip'){this.inspectorMode=action==='inspector-clip'?'clip':'section';this.renderInspector();return;}
    if(action==='import'){if(!this.discardOkay())return;const song=await this.job('song');if(song)this.newSong(song);return;}
    if(!this.session)throw new Error('Load a song first.');
    if(action==='save'){this.session.revision=this.revisions.get(this.session.id)??this.session.revision;this.session=await this.ipc('save',{session:this.session});this.revisions.set(this.session.id,this.session.revision);this.dirty=false;await this.refresh();this.message('Session saved.');return;}
    if(action==='undo'||action==='redo'){this.invalidate();this.session=this.history[action](this.session);this.session.revision=this.revisions.get(this.session.id)??this.session.revision;this.dirty=true;this.selected=Math.min(this.selected,this.session.sections.length-1);this.renderEditor();return;}
    if(action==='analyze'){await this.analyze();return;}
    if(action==='split'){
      this.regionEditor.commit(splitSongSection(this.session,Math.round(this.position||0)));return;
    }
    if(action==='merge'){this.regionEditor.commit(mergeSongSections(this.session,this.selected));return;}
    if(action==='assemble'||action==='variation'){
      const next=clone(this.session);if(action==='variation')next.seed++;
      const pool=this.catalog.clips.filter(c=>this.includeDrafts||c.review_status!=='draft');
      const assembled=arrange(next,pool);this.history.record(this.session);this.invalidate();this.session=assembled;this.dirty=true;this.renderEditor();
      this.message(`${assembled.placements.length} clips arranged. Locked sections retained.`);return;
    }
    if(action==='prepare'){await this.prepare();return;}
    if(action==='play'){this.regionEditor.pauseSource();if(this.player.intent){this.player.pause();return;}if(!this.prepared)await this.prepare();if(this.visible&&this.prepared)await this.player.play();return;}
    if(action==='stop'){this.regionEditor.pauseSource();this.player.pause();this.devices.release();if(this.prepared)await this.player.seek(0);this.tick(0);return;}
    if(action==='devices'){
      if(this.devices.active){this.devices.release();this.tick(this.position);return;}
      this.player.pause();if(!this.prepared)await this.prepare();
      if(!this.visible||!this.prepared)return;
      const armed=await this.devices.arm(this.prepared.snapshot,this.player.wrapper);this.tick(this.position);
      if(armed)this.message('Connected devices prepared. Press Play to start; editing pauses and releases sync.');return;
    }
    if(action==='render'){
      this.player.pause();this.devices.release();this.rendered=await this.job('render',{session:this.session});
      if(this.rendered){const box=this.root.querySelector('.fc-render');box.hidden=false;box.innerHTML=`<span>Ready: ${esc(this.rendered.name)} · ${this.rendered.output.width} × ${this.rendered.output.height} + six motion tracks</span><button data-action="open-render">Play in FunSync</button><button data-action="folder">Open export folder</button><button data-action="delete-render">Delete render</button>`;this.message('Temporary video and scripts exported.');}return;
    }
    if(action==='folder'){await this.ipc('export-folder',{id:this.rendered.id});return;}
    if(action==='delete-render'){
      if(!window.confirm('Delete this rendered video and its exported scripts? Your session and source clips remain available.'))return;
      if(this.app._currentVideoPath===this.rendered.path){this.app.videoPlayer.pause();this.app.videoPlayer.video.removeAttribute('src');this.app.videoPlayer.video.load();}
      await this.ipc('delete-render',{id:this.rendered.id});this.rendered=null;this.root.querySelector('.fc-render').hidden=true;this.message('Render deleted. The saved recipe can produce it again.');return;
    }
    if(action==='open-render'){
      const prepared=await this.ipc('render-scripts',{id:this.rendered.id});
      this.app.loadVideo({...this.rendered,_isPathBased:true},{autoPlay:false});
      const main={...prepared.L0,axes:Object.entries(prepared).filter(([axis])=>axis!=='L0').map(([id,script])=>({id,actions:script.actions}))};
      await this.app.loadFunscript({name:'session.funscript',textContent:JSON.stringify(main),path:this.rendered.scriptPath});return;
    }
    if(action==='mark-gap'){
      const start=Number(this.root.querySelector('[data-gap=start]').value)*1000,end=Number(this.root.querySelector('[data-gap=end]').value)*1000;
      const section=this.session.sections[this.selected];if(start<section.start_ms||end>section.end_ms||end<=start)throw new Error('Choose a nonempty gap inside this section.');
      this.edit(s=>{s.sections[this.selected].gaps.push([Math.round(start),Math.round(end)]);},{keepPlacements:true});return;
    }
    if(action==='clear-gaps'){this.edit(s=>{s.sections[this.selected].gaps=[];},{keepPlacements:true});return;}
  }
  async change(input){
    const field=input.dataset.field;if(!field)return;
    if(this.regionEditor.change(input))return;
    if(field==='drafts'){this.includeDrafts=input.checked;this.renderLibrary();this.renderInspector();return;}
    if(field==='library-view'||field==='library-sort'){this.renderLibrary();return;}
    if(field==='min_rating'){
      const minimum=Number(input.value);
      if(this.session)this.edit(s=>{s.min_rating=minimum;},{keepPlacements:true});
      else{this.defaultMinRating=minimum;this.renderLibrary();}
      this.message(minimum?`Only clips rated ${minimum}★ or higher qualify. Assemble to update existing choices.`:'All ratings qualify, including unrated clips.');return;
    }
    if(field==='rating'){
      const used=this.session?.placements.some(p=>p.clip_id===input.dataset.id);if(used)this.invalidate();
      this.catalog=await this.ipc('rating',{id:input.dataset.id,rating:input.value===''?null:Number(input.value)});
      if(used||this.ratingConflicts().length)this.invalidate();this.renderLibrary();this.renderInspector();this.draw();
      this.message('Clip rating saved. Reassemble if a used clip is below the session minimum.');return;
    }
    if(field==='volume'){this.player.audio.volume=Number(input.value);return;}
    if(field==='search')return;
    if(field==='seek'){this.setPosition(Number(input.value));return;}
    if(field==='tag'){this.catalog=await this.ipc('tag',{id:input.dataset.id,category:input.value});this.renderLibrary();this.renderInspector();return;}
    if(field==='song'){if(input.value&&this.discardOkay())this.newSong(this.catalog.songs.find(s=>s.id===input.value));return;}
    if(field==='saved'){
      if(!input.value||!this.discardOkay())return;const session=await this.ipc('load',{id:input.value});validateSession(session);this.analysisGeneration++;this.invalidate();this.session=session;this.revisions.set(session.id,session.revision);this.history=new History();this.selected=0;this.position=0;this.dirty=false;this.renderEditor();this.message('Session restored.');return;
    }
    if(field==='output-preset'||field==='output-fit'){
      this.edit(s=>{const current=outputSettings(s);s.output=field==='output-preset'?{preset:input.value,fit:'cover'}:{preset:current.preset,fit:input.value};},{keepPlacements:true});
      this.message('Output framing updated. Prepare preview to review the crop before rendering.');return;
    }
    if(['name','bpm','blend_ms'].includes(field)){this.edit(s=>{s[field]=field==='name'?input.value:Number(input.value);},{keepPlacements:true});return;}
    if(['source_in_ms','rate','clip_id'].includes(field)){
      this.edit(s=>{const p=s.placements.find(p=>p.id===this.selectedPlacement);if(!p)throw new Error('Select a clip on the timeline.');p[field]=field==='clip_id'?input.value:Number(input.value)*(field==='source_in_ms'?1000:1);delete s.asset_bindings;validateSession(s,this.catalog.clips);},{keepPlacements:true});return;
    }
    if(field==='end_ms'){
      this.regionEditor.commit(resizeSongSection(this.session,this.session.sections[this.selected].id,Math.round(Number(input.value)*1000),this.catalog.clips));return;
    }
    if(['category','motion','strength','label','locked'].includes(field)){
      this.edit(s=>{const section=s.sections[this.selected];section[field]=field==='locked'?input.checked:field==='strength'?Number(input.value):input.value;},{keepPlacements:field!=='category'});
    }
  }
  setPosition(time){this.position=Math.round(time);if(this.prepared)void this.player.seek(this.position).catch(e=>this.message(e.message,true));this.tick(this.position);}
  async analyze(){
    if(this.busy)throw new Error('Wait for the current task.');this.busy=true;this.player.pause();const gen=++this.analysisGeneration,id=this.session.id;
    const bar=this.root.querySelector('progress'),cancel=this.root.querySelector('[data-action=cancel]');bar.hidden=false;cancel.hidden=false;
    try{
      this.message('Analyzing song energy and beats…');const file=await(await fetch(this.session.song.url)).blob();const {samples,sampleRate}=await decodeBeatAudio(file);
      const analysis=await analyzeBeatAudio(samples,sampleRate,{character:true,cancelled:()=>gen!==this.analysisGeneration,progress:value=>{bar.value=value;}});
      if(gen!==this.analysisGeneration||this.session.id!==id)return;
      this.edit(s=>{s.analysis=analysis;s.bpm=analysis.bpm||120;},{keepPlacements:true});
      this.message(`Analysis ready · ${analysis.bpm||'unknown'} BPM · ${Math.round(analysis.confidence*100)}% confidence. Adjust BPM and section boundaries as needed.`);
    }finally{this.busy=false;bar.hidden=true;cancel.hidden=true;}
  }
  async prepare(){
    if(this.preparing)throw new Error('Preview is being prepared.');this.preparing=true;
    try{this.invalidate();const generation=this.preparationGeneration,session=this.session;this.message('Compiling the session…');const prepared=await this.ipc('prepare',{session});
      if(this.session!==session||!this.visible||generation!==this.preparationGeneration)return;
      this.prepared=prepared;this.session.asset_bindings=prepared.asset_bindings;
      await this.player.load(prepared.snapshot,prepared.clips);this.root.querySelector('.fc-preview-empty').hidden=true;this.draw();
      this.message(prepared.snapshot.warnings.length?prepared.snapshot.warnings.join(' · '):'Preview ready. Video, motion and audio share the song clock.');
    }finally{this.preparing=false;}
  }
  minimumRating(){return this.session ? this.session.min_rating??0 : this.defaultMinRating;}
  ratingConflicts(){
    const clips=new Map(this.catalog.clips.map(c=>[c.id,c]));
    return [...new Set((this.session?.placements||[]).filter(p=>p.clip_id&&clipRating(clips.get(p.clip_id))<this.minimumRating()).map(p=>p.clip_id))];
  }
  renderLibrary(){
    const search=this.root.querySelector('[data-field=search]').value.toLowerCase();
    const view=this.root.querySelector('[data-field=library-view]').value,sort=this.root.querySelector('[data-field=library-sort]').value,minimum=this.minimumRating();
    this.root.querySelector('[data-field=min_rating]').value=String(minimum);
    const used=new Map();for(const p of this.session?.placements||[])if(p.clip_id)used.set(p.clip_id,(used.get(p.clip_id)||0)+1);
    const clips=this.catalog.clips.filter(c=>
      (view==='used'?used.has(c.id):(this.includeDrafts||c.review_status!=='draft')&&clipRating(c)>=minimum)&&
      (view!=='ready'||ready(c))&&(view!=='local'||c.available)&&`${c.name} ${(c.categories||[]).join(' ')}`.toLowerCase().includes(search))
      .sort((a,b)=>(sort==='rating'?clipRating(b)-clipRating(a):0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    const conflicts=this.ratingConflicts(),warning=this.root.querySelector('.fc-rating-warning');warning.hidden=!conflicts.length;
    warning.textContent=`${conflicts.length} used clip${conflicts.length===1?' is':'s are'} below ${minimum}★. Unlock affected sections and assemble again, or replace them. “Used in session” keeps these clips visible.`;
    this.root.querySelector('.fc-library-count').textContent=`${clips.length} shown · ${clips.filter(ready).length} ready with motion · ${clips.filter(c=>c.available&&!c.script_ready).length} video only · ${clips.filter(c=>!c.available).length} unavailable`;
    this.root.querySelector('.fc-clips').innerHTML=clips.map(c=>{
      const rating=clipRating(c),override=c.user_rating!==undefined;
      const status=ready(c)?'Ready · video + motion':c.origin==='dataset'?'Needs resolving · video + scripts':c.available?'Video only · use Follow song':'Unavailable · rescan folder';
      return `<article class="fc-clip" data-clip-id="${esc(c.id)}" data-rating="${rating}"><div class="fc-clip-top"><strong title="${esc(c.name)}">${esc(c.name)}</strong><span>${stamp(c.duration_ms)}</span></div>
        <div class="fc-clip-rating" aria-label="${rating?`${rating} out of 5 stars`:'Unrated'}">${rating?'★'.repeat(rating)+'☆'.repeat(5-rating):'Unrated'}<small>${override?'Your rating':c.origin==='dataset'?'Dataset rating':'No rating yet'}</small></div>
        <div class="fc-clip-availability ${ready(c)?'fc-ready':''}">${status}</div>
        <small>${esc(c.review_status)}${c.script_ready?' · '+esc((c.axes||[]).join(' / ')):''}${used.has(c.id)?` · Used ${used.get(c.id)}×`:''}</small>
        ${rating<minimum?'<div class="fc-rating-warning">Below session minimum</div>':''}
        <label>Rate this clip<select data-field="rating" data-id="${esc(c.id)}" aria-label="Rating for ${esc(c.name)}">${options([['',c.origin==='dataset'?`Use dataset rating (${ratingLabel(clipRating({quality:c.quality}))})`:'No local rating'],...Array.from({length:6},(_,n)=>[String(n),ratingLabel(n)])],override?String(c.user_rating):'')}</select></label>
        <label>Category<input data-field="tag" data-id="${esc(c.id)}" value="${esc(c.categories?.[0]||'Uncategorized')}"></label>${c.origin==='dataset'?`<button data-action="resolve" data-id="${esc(c.id)}">${ready(c)?'Verify / refresh':'Resolve video + scripts'}</button>`:''}</article>`;
    }).join('')||`<p class="fc-empty">${!this.catalog.clips.length?'Add your downloaded clip folder, or sync the dataset to browse script variants.':view==='used'?'No used clips match. Assemble a session or clear the search.':'No clips match. Lower the minimum rating, change the view, or clear the search.'}</p>`;
  }
  renderOutput(){
    const output=outputSettings(this.session||{output:DEFAULT_OUTPUT});
    for(const key of ['preset','fit']){const input=this.root.querySelector(`[data-field=output-${key}]`);input.value=output[key];input.disabled=!this.session;}
    this.root.querySelector('.fc-preview-stage').style.setProperty('--fc-output-ratio',output.width/output.height);
    for(const video of this.root.querySelectorAll('.fc-preview video'))video.style.objectFit=output.fit;
  }
  renderEditor(){
    this.renderLibrary();this.renderOutput();const s=this.session;if(!s)return;
    this.selected=Math.min(this.selected,s.sections.length-1);
    if(!s.placements.some(p=>p.id===this.selectedPlacement&&p.section_id===s.sections[this.selected].id))this.selectedPlacement=null;
    this.root.querySelector('.fc-song-title').textContent=`${s.name} · ${stamp(s.song.duration_ms)}`;
    this.root.querySelector('[data-field=seek]').max=s.song.duration_ms;
    this.root.querySelector('.fc-section-strip').innerHTML=s.sections.map((section,i)=>`<button class="${i===this.selected?'fc-selected':''}" data-section="${i}" style="flex:${section.end_ms-section.start_ms}" title="${esc(section.label)}">${esc(section.label)}</button>`).join('');
    this.regionEditor.renderTrack();
    this.root.querySelector('.fc-sections').innerHTML=s.sections.map((section,i)=>`<button class="fc-section-row ${i===this.selected?'fc-selected':''}" data-section="${i}"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(section.label)}</strong><span>${stamp(section.start_ms)} – ${stamp(section.end_ms)}</span><span>${esc(sectionCategories(section).join(', ')||'Any category')}</span><span>${esc(policies.find(([id])=>id===section.motion)?.[1])}</span><span>${section.locked?'Locked':section.strength+'%'}</span></button>`).join('');
    this.root.querySelector('.fc-summary').textContent=`${s.sections.length} sections · ${s.placements.length} cuts · variation ${s.seed}${this.dirty?' · unsaved changes':''}`;
    this.renderInspector();this.draw();
  }
  renderInspector(){
    if(!this.session)return;const s=this.session,section=s.sections[this.selected];
    const selectedCategories=sectionCategories(section),categories=[...new Set(this.catalog.clips.flatMap(c=>c.categories||[]).concat(selectedCategories))].sort();
    this.regionEditor.pauseSource();
    const sectionHTML=`<label>Section name<input data-field="label" value="${esc(section.label)}"></label><fieldset class="fc-category-pool"><legend>Folder categories · choose several</legend><label class="fc-check"><input data-field="section-all" type="checkbox" ${!selectedCategories.length?'checked':''}> Any category</label>${categories.map(c=>`<label class="fc-check"><input data-field="section-category" data-category="${esc(c)}" type="checkbox" ${selectedCategories.includes(c)?'checked':''}> ${esc(c)}</label>`).join('')}</fieldset><label>Motion<select data-field="motion">${options(policies,section.motion)}</select></label><label>Strength (%)<input data-field="strength" type="number" min="0" max="100" value="${section.strength}"></label><label>Section ends at (seconds)<input data-field="end_ms" type="number" step="0.001" value="${section.end_ms/1000}" ${this.selected===s.sections.length-1?'disabled':''}></label><label class="fc-check"><input data-field="locked" type="checkbox" ${section.locked?'checked':''}> Keep clips on variation</label>
      ${section.motion==='gaps'?`<div class="fc-gap"><h3>Marked motion gaps</h3><p>Only these ranges receive song motion.</p><label>Start (seconds)<input data-gap="start" type="number" step="0.01" value="${section.start_ms/1000}"></label><label>End (seconds)<input data-gap="end" type="number" step="0.01" value="${section.end_ms/1000}"></label><button data-action="mark-gap">Add gap</button><button data-action="clear-gaps">Clear</button><small>${section.gaps.map(([a,b])=>stamp(a)+'–'+stamp(b)).join(', ')||'No gaps marked'}</small></div>`:''}`;
    const clipMode=this.inspectorMode==='clip'&&!!this.regionEditor.selected();
    this.root.querySelector('.fc-inspector>h2').textContent=clipMode?'Clip region':'Section settings';
    this.root.querySelector('[data-action=inspector-clip]').disabled=!this.regionEditor.selected();
    for(const key of ['section','clip'])this.root.querySelector(`[data-action=inspector-${key}]`).classList.toggle('fc-active',clipMode===(key==='clip'));
    this.root.querySelector('.fc-inspector-content').innerHTML=clipMode?`<div class="fc-region-inspector"><small>Section: ${esc(section.label)}</small>${this.regionEditor.inspectorHTML()}</div>`:sectionHTML;
    this.regionEditor.bindSourcePreview();
    this.root.querySelector('.fc-session-settings').innerHTML=`<h2>Session</h2><label>Name<input data-field="name" value="${esc(s.name)}"></label><label>Song BPM<input data-field="bpm" type="number" min="30" max="300" value="${s.bpm||120}"></label><label>Motion blend (ms)<input data-field="blend_ms" type="number" min="0" max="2000" step="10" value="${s.blend_ms}"></label><p>Video uses clean cuts. Motion blends around each cut. Beat analysis is a starting point; sections remain editable.</p>`;
  }
  tick(time=0){
    if(this.prepared)this.position=time;
    this.root.querySelector('.fc-time').textContent=stamp(time);
    this.root.querySelector('[data-field=seek]').value=time;
    this.root.querySelector('[data-action=play]').textContent=this.player.intent?'Ⅱ Pause':'▶ Play';
    this.root.querySelector('[data-action=devices]').textContent=this.devices.active?'Release device sync':'Prepare device sync';
    this.root.querySelector('.fc-preview-label').textContent=this.devices.active?'PREVIEW · DEVICE SYNC READY':this.prepared?'PREVIEW · DEVICES OFF':'PREVIEW · NEEDS PREPARATION';
    this.root.querySelector('.fc-playhead').style.left=`${Math.min(100,time/(this.session?.song.duration_ms||1)*100)}%`;
    if(this.devices.active)this.app.sessionTracker?.setPlayback({currentTime:time/1000,duration:this.session.song.duration_ms/1000,paused:this.player.audio.paused});
  }
  draw(){
    if(!this.session)return;
    for(const [selector,values,color] of [['.fc-wave',this.session.analysis?.waveform,'#7dd3fc'],['.fc-motion',this.prepared?.snapshot.scripts.L0.actions,'#c4b5fd']]){
      const canvas=this.root.querySelector(selector),width=Math.floor(canvas.clientWidth);if(!width)continue;canvas.width=width*devicePixelRatio;canvas.height=64*devicePixelRatio;
      const ctx=canvas.getContext('2d');ctx.scale(devicePixelRatio,devicePixelRatio);ctx.clearRect(0,0,width,64);ctx.strokeStyle=color;ctx.lineWidth=1.3;ctx.beginPath();
      if(values?.length)for(let x=0;x<width;x++){
        if(selector==='.fc-wave'){const h=values[Math.floor(x/width*values.length)]*28;ctx.moveTo(x,32-h);ctx.lineTo(x,32+h);}
        else{const y=58-evaluate(values,x/width*this.session.song.duration_ms)*.52;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
      }else{ctx.moveTo(0,32);ctx.lineTo(width,32);}ctx.stroke();
    }
  }
  credentials(){
    const dialog=document.createElement('dialog');dialog.className='fc-dialog';dialog.innerHTML=`<form method="dialog"><h2>Civitai access</h2><label>Site<select name="site">${options(['civitai.com','civitai.red','civitaired.com'].map(s=>[s,s]),this.site||'civitai.com')}</select></label><label>API key<input name="key" type="password" autocomplete="off" placeholder="Leave empty to keep the stored key"></label><p>The key stays in encrypted local storage. Videos are downloaded only when you resolve a selected clip.</p><div class="fc-actions"><button value="cancel">Cancel</button><button value="save">Save</button><button value="remove">Remove key</button></div></form>`;
    dialog.addEventListener('close',()=>{const value=dialog.querySelector('[name=key]').value;this.site=dialog.querySelector('[name=site]').value;dialog.querySelector('[name=key]').value='';const result=dialog.returnValue;dialog.remove();if(result==='remove'||(result==='save'&&value))void this.ipc('key',{value:result==='remove'?'':value}).then(()=>this.message('API settings saved.')).catch(e=>this.message(e.message,true));});
    this.root.append(dialog);dialog.showModal();
  }
}
