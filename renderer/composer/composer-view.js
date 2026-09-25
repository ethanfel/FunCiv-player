import { createSession, arrange, validateSession, clipRating, isDraftClip, isAudioSyncClip, History, clone, DEFAULT_OUTPUT, OUTPUT_PRESETS, outputSettings, splitSongSection, mergeSongSections, resizeSongSection, normalizeSectionNames } from '../../packages/composer-core/index.mjs';
import { analyzeBeatAudio, decodeBeatAudio } from '../../vendor/motion-studio/audio-analysis.mjs';
import { CompositionPlayer } from './composition-player.js';
import { ComposerDeviceSession } from './device-session.js';
import { RegionEditor, REGION_TOOLS } from './region-editor.js';
import { TimelineViewport, TIMELINE_TOOLS } from './timeline-viewport.js';
import { ClipLibrary } from './clip-library.js';
import { SectionEditor } from './section-editor.js';
import { pendingLocalScripts } from './clip-readiness.js';
import { sectionPoolLabel } from './folder-model.js';
import { videoIdentities } from '../../packages/composer-core/video-identity.mjs';
import { offerDraftAssembly } from './assembly-dialog.js';
import { acceptDraftAssembly } from '../../packages/composer-core/draft-proposal.mjs';
import { DEFAULT_AUTO_CLIPS } from '../../packages/composer-core/auto-clips.mjs';
import { composerShortcut } from './keyboard.js';
import { PLAYER_MARKUP, PreviewControls } from './preview-controls.js';
import { MUSIC_MARKUP } from './music-markup.js';
import { MusicEditor } from './music-editor.js';
import { openTagPicker, sectionTagLabel } from './tag-picker.js';
import { clipTagIndex, tagKey } from '../../packages/composer-core/tags.mjs';
import { clipMetadataIndex, sourceValues, matchesSourceFilters, sourceFilterCount, sourceFilterConflicts } from '../../packages/composer-core/source-metadata.mjs';
import { openSourceFilters, sourceFilterLabel } from './source-filters.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=ms=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(1).padStart(4,'0')}`;
const options=(values,selected)=>values.map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');
const policies=[['clip','Clip / audio sync'],['song','Follow song'],['gaps','Clip + marked gaps'],['hold','Neutral hold']];
const ready=clip=>clip.available&&(clip.script_ready||isAudioSyncClip(clip));

export class ComposerView {
  constructor(app,root){
    this.app=app;this.root=root;this.history=new History();this.catalog={clips:[],songs:[]};this.saved=[];this.revisions=new Map();
    this.devices=new ComposerDeviceSession(app);this.analysisGeneration=0;this.preparationGeneration=0;this.selected=0;this.dirty=false;this.defaultMinRating=0;this.defaultIncludeDrafts=false;
    this.root.innerHTML=`
      <header class="fc-header"><div><span class="fc-eyebrow">FUNCIV / COMPOSER</span><h1>Make a session from a song.</h1></div>
        <div class="fc-actions"><select data-field="saved" aria-label="Saved sessions"><option value="">Open session…</option></select><button data-action="save">Save session</button><button data-action="import" class="fc-primary">＋ Load song</button></div></header>
      <div class="fc-status" role="status" aria-live="polite"><span data-status>Load a song and add a folder of clips to begin.</span><progress hidden max="1"></progress><button data-action="cancel" hidden>Cancel</button></div>
      <div class="fc-workspace">
        <aside class="fc-library"><div class="fc-panel-heading"><h2>Clip library</h2><button data-action="scan">＋ Folder</button></div>
          <div class="fc-library-tools"><button data-action="dataset">Sync FunCiv Data</button><button data-action="credentials">API settings</button></div>
          <div class="fc-local-library"></div>
          <label class="fc-search">Find clips<input data-field="search" type="search" placeholder="Name, creator, model or tags…"></label>
          <label>Show<select data-field="library-view"><option value="all">All catalog</option><option value="ready">Ready for motion</option><option value="local">Local videos</option><option value="audio-sync">Audio sync clips</option><option value="used">Used in session</option></select></label>
          <button data-action="library-sources" class="fc-browse-sources">Browse source filters</button><small class="fc-browse-source-note">Library browsing only</small>
          <details class="fc-library-filters"><summary>Filters <span class="fc-library-filter-summary"></span></summary>
          <label>Minimum rating for session<select data-field="min_rating">${options([[0,'All ratings (including unrated)'],[1,'1★ or higher'],[2,'2★ or higher'],[3,'3★ or higher'],[4,'4★ or higher'],[5,'5★ only']].map(([n,label])=>[String(n),label]),'0')}</select></label>
          <small>Assembly combines star ratings with recent-use weight. This minimum applies to assembly, preview and export.</small>
          <label>Sort clips<select data-field="library-sort"><option value="rating">Rating: highest first</option><option value="name">Name: A–Z</option></select></label>
          <label class="fc-check"><input data-field="drafts" type="checkbox" aria-describedby="fc-draft-help"> Include draft scripts (unreviewed)</label>
          <small id="fc-draft-help">Saved with this session. Star ratings do not mean a script has been reviewed.</small>
          <small class="fc-dataset-review" role="status" hidden></small>
          </details>
          <div class="fc-draft-warning" role="status" hidden></div>
          <div class="fc-rating-warning" role="status" hidden></div>
          <div class="fc-source-warning" role="status" hidden></div>
          <div class="fc-library-count"></div><div class="fc-clips" aria-label="Clip library results"></div><div class="fc-clip-details" hidden></div>
        </aside>
        <main class="fc-main">
          <div class="fc-songbar"><div class="fc-song-title">No song loaded</div><div class="fc-actions"><button data-action="session-sources" title="Restrict new clip choices by creator, source model and source dimensions">Source filters</button><button data-action="session-tags" title="Guide clip choices with optional session-wide tag preferences">Session tags</button><select data-field="song" aria-label="Previously imported songs"><option value="">Recent songs…</option></select><button data-action="analyze">Analyze song</button></div></div>
          <div class="fc-workspace-tabs" role="tablist" aria-label="Composer editor"><button id="fc-arrangement-tab" data-action="tab-arrangement" role="tab" aria-controls="fc-arrangement-panel" aria-selected="true">Video arrangement</button><button id="fc-music-tab" data-action="tab-music" role="tab" aria-controls="fc-music-panel" aria-selected="false" tabindex="-1">Music &amp; beats</button></div>
          <div class="fc-output-settings"><label>Output format<select data-field="output-preset">${options(OUTPUT_PRESETS.map(p=>[p.id,p.label]),DEFAULT_OUTPUT.preset)}</select></label><label>Scaling<select data-field="output-fit">${options([['cover','Fill frame (center crop)'],['contain','Fit frame (black bars)']],DEFAULT_OUTPUT.fit)}</select></label><small>30 fps · preview matches export framing</small></div>
          ${PLAYER_MARKUP}
          ${MUSIC_MARKUP}
          <section id="fc-arrangement-panel" role="tabpanel" aria-labelledby="fc-arrangement-tab">
          ${REGION_TOOLS}
          ${TIMELINE_TOOLS}
          <div class="fc-selection-bar">Select a song section to choose its folders.</div>
          <div class="fc-timeline-viewport"><div class="fc-timeline"><div class="fc-audio-markers"></div><canvas class="fc-ruler" height="28" aria-label="Song time ruler"></canvas><canvas class="fc-wave" height="64" aria-label="Song energy waveform"></canvas><div class="fc-track-label">Song sections · drag purple dividers to resize · folders below</div><div class="fc-section-strip"></div><div class="fc-track-label">Clip regions · smaller cuts inside song sections</div><div class="fc-placement-strip"></div><canvas class="fc-saved-beats" height="54" aria-label="Saved beat script for Audio sync and Follow song"></canvas><canvas class="fc-motion" height="64" aria-label="Compiled motion curve"></canvas><div class="fc-playhead"></div></div></div>
          <div class="fc-editbar"><button data-action="undo">↶ Undo</button><button data-action="redo">↷ Redo</button><button data-action="split" title="Create two independent song sections at the playhead, each with its own folders">Split song section</button><button data-action="merge">Merge song sections</button><span class="fc-spacer"></span><button data-action="assemble" class="fc-primary">Assemble</button><button data-action="variation">New variation</button></div>
          <div class="fc-sections"></div>
          <div class="fc-footer"><div class="fc-summary">Choose a song to build your timeline.</div><div class="fc-actions"><button data-action="render" class="fc-primary">Render temporary video</button></div></div>
          <div class="fc-render" hidden></div>
          </section>
        </main>
        <aside class="fc-inspector"><h2>Section settings</h2><div class="fc-inspector-tabs"><button data-action="inspector-section">Section</button><button data-action="inspector-clip" disabled>Clip region</button></div><div class="fc-inspector-content">Select a section to edit its category and motion.</div><div class="fc-session-settings"></div></aside>
      </div>`;
    this.player=new CompositionPlayer(this.root.querySelector('audio'),[...this.root.querySelectorAll('video')],time=>this.tick(time),message=>this.message(message,true));
    this.player.audio.volume=.7;
    this.previewControls=new PreviewControls(this);
    this.root.addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(button){void this.action(button.dataset.action,button).catch(e=>this.message(e.message,true));return;}
      const section=event.target.closest('[data-section]');if(section)this.selectSection(Number(section.dataset.section));
      const placement=event.target.closest('button[data-placement]');if(placement)this.regionEditor.select(placement.dataset.placement);
    });
    this.root.addEventListener('change',event=>{void this.change(event.target).catch(e=>{this.message(e.message,true);this.renderEditor();});});
    this.root.querySelector('[data-field=search]').addEventListener('input',()=>this.renderLibrary());
    this.root.ownerDocument.addEventListener('keydown',event=>composerShortcut(event,this),true);
    this.resizeObserver=new ResizeObserver(()=>this.draw());this.resizeObserver.observe(this.root);
    this.regionEditor=new RegionEditor(this);
    this.timeline=new TimelineViewport(this);this.clipLibrary=new ClipLibrary(this);
    this.sectionEditor=new SectionEditor(this);
    this.musicEditor=new MusicEditor(this);
    this.root.querySelector('.fc-workspace-tabs').addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const active=event.key==='End'||event.key==='ArrowRight';this.musicEditor.open(active);this.root.querySelector(active?'#fc-music-tab':'#fc-arrangement-tab').focus();
    });
    this.root.querySelector('[data-field=zoom-slider]').addEventListener('input',event=>this.timeline.setZoom(2**Number(event.target.value)));
    this.renderOutput();
    window.addEventListener('beforeunload',event=>{if(this.dirty){event.preventDefault();event.returnValue='';}});
  }
  ipc(action,payload){return window.funsync.composer(action,payload);}
  async show(){this.visible=true;await this.refresh();this.renderEditor();}
  hide(){this.visible=false;this.previewControls?.hide();this.musicEditor?.hide();this.timeline.finishDrag();this.sectionEditor.finishDrag(true);this.regionEditor.finishDrag(true);this.invalidate({pause:true});this.analysisGeneration++;this.tick(this.position||0);}
  message(text,error=false){const box=this.root.querySelector('.fc-status');box.classList.toggle('fc-error',error);box.querySelector('[data-status]').textContent=text;this.previewControls?.message(text,error);}
  async refresh(){
    const oldMotion=new Map(this.catalog.clips.map(c=>[c.id,isAudioSyncClip(c)]));
    this.catalog=await this.ipc('state');
    const changedMotion=this.session?.placements.some(p=>oldMotion.has(p.clip_id)&&oldMotion.get(p.clip_id)!==isAudioSyncClip(this.catalog.clips.find(c=>c.id===p.clip_id)));
    if(changedMotion||this.ratingConflicts().length||this.draftConflicts().length)this.invalidate();this.saved=await this.ipc('sessions');
    this.root.querySelector('[data-field=saved]').innerHTML='<option value="">Open session…</option>'+options(this.saved.map(s=>[s.id,s.name]),'');
    this.root.querySelector('[data-field=song]').innerHTML='<option value="">Recent songs…</option>'+options(this.catalog.songs.map(s=>[s.id,s.name]),'');
    this.renderLibrary();this.renderInspector();this.musicEditor?.render();this.draw();
  }
  async job(action,payload){
    if(this.busy)throw new Error('Wait for the current task or cancel it.');
    this.busy=true;const progress=this.root.querySelector('progress'),cancel=this.root.querySelector('[data-action=cancel]');
    try{
      const job=await this.ipc(action,payload);if(!job)return null;
      if(['scan','rescan','dataset','resolve','fetch-scripts'].includes(action))this.invalidate();
      this.jobId=job.id;progress.hidden=false;cancel.hidden=false;
      while(true){const state=await this.ipc('job',{id:job.id});progress.value=state.progress;this.message(state.message);
        if(state.state==='completed'){await this.refresh();return state.result;}
        if(state.state!=='running')throw new Error(state.error||'Task cancelled.');
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    }finally{this.busy=false;this.jobId=null;progress.hidden=true;cancel.hidden=true;this.musicEditor?.render();this.schedulePreviewRefresh();}
  }
  invalidate({pause=false}={}){
    this.preparationGeneration++;this.regionEditor?.pauseSource();this.devices.release();
    if(pause)this.player.pause();
    this.player.detachPreview();this.prepared=null;
    this.previewRefreshPending=!pause&&!this.songOnly();
    this.root.querySelector('.fc-preview-empty').hidden=false;
    this.tick(this.position||0);this.schedulePreviewRefresh();
  }
  schedulePreviewRefresh(){
    clearTimeout(this.previewRefreshTimer);
    if(!this.previewRefreshPending||!this.visible||this.songOnly()||this.preparing||this.busy)return;
    this.previewRefreshTimer=setTimeout(()=>{
      // Dragging changes the session on each move. Its final render schedules
      // one compilation for the committed (or restored) state.
      if(this.busy||this.preparing||this.regionEditor.drag||this.sectionEditor.drag)return;
      void this.prepare({live:true}).catch(e=>this.message(`Preview could not update: ${e.message}`,true));
    },250);
  }
  edit(fn,{keepPlacements=false,affectsPlayback=true}={}){
    if(!this.session)throw new Error('Load a song first.');
    const next=clone(this.session);fn(next);if(!keepPlacements){next.placements=[];next.sections.forEach(s=>{s.locked=false;s.planned_regions=false;});delete next.asset_bindings;}
    validateSession(next);this.history.record(this.session);if(affectsPlayback)this.invalidate();
    else if(this.preparationContext?.session===this.session)this.preparationContext.session=next;
    this.session=next;this.dirty=true;this.renderEditor();
  }
  newSong(song){
    this.analysisGeneration++;this.invalidate({pause:true});const minimum=this.minimumRating(),drafts=this.includeDrafts;this.session=createSession(song);this.session.auto_clip={...DEFAULT_AUTO_CLIPS};this.session.min_rating=minimum;this.session.include_drafts=drafts;this.selected=0;this.selectedPlacement=null;this.history=new History();this.dirty=true;this.position=0;this.timeline.reset();this.loadSongPlayback();this.renderEditor();this.message('Song ready. Press Play to listen and mark sections; analyze it when ready.');
  }
  selectSection(index){if(!this.session)return;this.selected=Math.max(0,Math.min(index,this.session.sections.length-1));this.inspectorMode='section';this.selectedPlacement=this.session.placements.find(p=>p.section_id===this.session.sections[this.selected].id)?.id;this.renderEditor();}
  songOnly(){return this.root.querySelector('[data-field=playback-mode]').value==='song';}
  loadSongPlayback(){
    this.root.querySelector('[data-field=playback-mode]').value='song';
    this.root.querySelector('.fc-preview-empty').hidden=false;
    void this.player.loadSong(this.session.song,this.position||0).catch(e=>this.message(e.message,true));
  }
  discardOkay(){return !this.dirty||window.confirm('Leave this session without saving your changes?');}
  save(){
    const current=this.session,snapshot=clone(current);
    // Serialize this view's requests, but let editing and navigation continue.
    // A reply acknowledges its own snapshot, never a newer editor state.
    const operation=async()=>{
      snapshot.revision=this.revisions.get(snapshot.id)??snapshot.revision;
      const saved=await this.ipc('save',{session:snapshot});
      this.revisions.set(saved.id,saved.revision);
      if(this.session?.id===saved.id)this.session.revision=saved.revision;
      const unchanged=this.session===current;
      if(unchanged){Object.assign(current,saved);this.dirty=false;}
      await this.refresh();
      this.message(this.session===current&&!this.dirty?'Session saved.':`Saved “${saved.name}”. Current edits are preserved.`);
      return saved;
    };
    this.saveQueue=(this.saveQueue||Promise.resolve()).catch(()=>{}).then(operation);
    return this.saveQueue;
  }
  async action(action,button){
    if(['library-sources','session-sources','section-sources'].includes(action)){openSourceFilters(this,action.split('-')[0],button.dataset.id);return;}
    if(action==='session-tags'||action==='section-tags'){openTagPicker(this,action==='section-tags'?button.dataset.id:null);return;}
    if(action==='tab-music'||action==='tab-arrangement'){this.musicEditor.open(action==='tab-music');return;}
    if(action==='fullscreen'){await this.previewControls.toggleFullscreen();return;}
    if(action==='connections'){await this.previewControls.openConnections();return;}
    if(action==='mute'){const a=this.player.audio;if(a.volume===0){a.volume=.7;this.root.querySelector('[data-field=volume]').value=.7;a.muted=false;}else a.muted=!a.muted;this.tick(this.position||0);return;}
    if(this.timeline.action(action))return;
    if(action==='inspect-library-clip'){this.clipLibrary.select(button.dataset.id);return;}
    if(action==='reset-category'){this.catalog=await this.ipc('tag',{id:button.dataset.id,category:null});this.renderLibrary();this.renderInspector();this.message('Imported categories restored.');return;}
    if(action==='select-section'){this.selectSection(Number(button.dataset.index));return;}
    if(action==='section-folders'){this.regionEditor.folders(button.dataset.id);return;}
    if(await this.regionEditor.action(action,button))return;
    if(action==='cancel'){this.analysisGeneration++;if(this.jobId)await this.ipc('cancel',{id:this.jobId});return;}
    if(action==='scan'||action==='rescan'){const result=await this.job(action);if(result)this.message(`${result.count} local clips indexed${result.linked!==undefined?' · '+result.linked+' HF entries linked':''}.${result.warnings.length?' '+result.warnings.slice(0,3).join(' · '):' Matching HF entries now use local videos. Get HF scripts if needed.'}`);return;}
    if(action==='fetch-scripts'){
      const ids=button?.dataset.id?[button.dataset.id]:pendingLocalScripts(this.catalog.clips,{include_drafts:this.includeDrafts,min_rating:this.minimumRating()}).map(c=>c.id);
      if(!ids.length){this.message('No linked videos need HF scripts with the current rating and draft filters.');return;}
      const result=await this.job('fetch-scripts',{ids});if(result)this.message(`${result.count} HF script sets fetched. Local videos reused.${result.warnings.length?' '+result.warnings.slice(0,3).join(' · '):''}`);return;
    }
    if(action==='dataset'){const result=await this.job('dataset');if(result)this.message(`${result.count} HF script variants indexed. Existing local folders are matched automatically; add a folder if your videos are not linked yet.`);return;}
    if(action==='resolve'){await this.job('resolve',{id:button.dataset.id,site:this.site||'civitai.com'});this.message('Video and verified scripts are ready. Binding checked by duration; preview before use.');return;}
    if(action==='credentials'){this.credentials();return;}
    if(action==='inspector-section'||action==='inspector-clip'){this.inspectorMode=action==='inspector-clip'?'clip':'section';this.renderInspector();return;}
    if(action==='import'){if(!this.discardOkay())return;const song=await this.job('song');if(song)this.newSong(song);return;}
    if(!this.session)throw new Error('Load a song first.');
    if(action==='seek-back'||action==='seek-forward'){this.setPosition((this.position||0)+(action==='seek-back'?-10000:10000));return;}
    if(action==='save'){await this.save();return;}
    if(action==='undo'||action==='redo'){this.invalidate();this.session=this.history[action](this.session);this.session.revision=this.revisions.get(this.session.id)??this.session.revision;this.dirty=true;this.selected=Math.min(this.selected,this.session.sections.length-1);this.renderEditor();return;}
    if(action==='analyze'){await this.analyze();return;}
    if(action==='split'){
      const at=Math.round(this.position||0),next=splitSongSection(this.session,at);this.selected=next.sections.findIndex(s=>s.start_ms===at);this.inspectorMode='section';this.regionEditor.commit(next);this.message('Song section split. Both sections are independent and can use different folders.');return;
    }
    if(action==='merge'){this.regionEditor.commit(mergeSongSections(this.session,this.selected));return;}
    if(action==='assemble'||action==='variation'){
      const initial=this.session,next=clone(initial);next.auto_clip??={...DEFAULT_AUTO_CLIPS};if(action==='variation')next.seed++;
      let assembled;
      try{assembled=arrange(next,this.catalog.clips);}
      catch(error){
        const proposal=await offerDraftAssembly(this,next,error);
        if(!proposal){this.message(error.message,true);return;}
        if(this.session!==initial)throw new Error('The session changed. Assemble again to review the current draft choices.');
        if(proposal.fetchIds.length){
          const fetched=await this.job('fetch-scripts',{ids:proposal.fetchIds});
          if(this.session!==initial)throw new Error('The session changed while fetching scripts. Assemble again.');
          if(fetched.warnings.length)throw new Error(`Some scripts could not be fetched. ${fetched.warnings.slice(0,3).join(' · ')}`);
        }
        assembled=acceptDraftAssembly(proposal,this.catalog.clips);
      }
      this.history.record(initial);this.invalidate();this.session=assembled;this.dirty=true;this.renderEditor();
      this.message(`${assembled.placements.length} clips arranged. ${assembled.repeat_policy==='cycle'?'Repeats allowed after matching videos have been used.':'No new video repeats.'}${assembled.include_drafts&&!initial.include_drafts?' Draft scripts included; Undo restores the previous choice.':''}`);return;
    }
    if(action==='prepare'){await this.prepare();return;}
    if(action==='play'){
      if(this.devicePreparing){this.message('Device sync is being prepared. Play will be available when it is ready.');return;}
      this.regionEditor.pauseSource();if(this.player.intent){this.player.pause();return;}
      if(this.songOnly()){this.devices.release();if(this.visible)await this.player.play();return;}
      if(!this.prepared){if(this.preparationTask)await this.preparationTask;else await this.prepare();}if(this.visible&&this.prepared)await this.player.play();return;
    }
    if(action==='stop'){this.regionEditor.pauseSource();this.player.pause();this.devices.release();await this.player.seek(0);this.tick(0);return;}
    if(action==='devices'){
      if(this.devicePreparing)return;
      if(this.devices.active){this.devices.release();this.tick(this.position);return;}
      this.devicePreparing=true;this.tick(this.position);
      try{
        this.player.pause();const preparation=this.prepared?null:this.prepare(),generation=this.devices.generation;
        await preparation;
        if(!this.visible||!this.prepared||generation!==this.devices.generation)return;
        this.player.keepAudioRunning=false;
        const prepared=this.prepared,armed=await this.devices.arm(prepared.snapshot,this.player.wrapper);
        if(armed){
          try{this.catalog=await this.ipc('record-use',{token:prepared.usage_token});this.renderLibrary();}
          catch(error){this.message(`Device sync ready, but clip-use history could not be saved: ${error.message}`,true);return;}
          this.message('Device sync ready. Press Play to start video and motion together. Clip-use history saved.');
        }
      }finally{this.devicePreparing=false;this.tick(this.position);}
      return;
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
    if(field==='drafts'){
      if(this.session)this.edit(s=>{s.include_drafts=input.checked;},{keepPlacements:true});
      else{this.defaultIncludeDrafts=input.checked;this.renderLibrary();this.renderInspector();}
      this.message(this.includeDrafts?'Unreviewed drafts are allowed. The minimum star rating still applies.':'Draft scripts are excluded. Reassemble or replace any drafts already used.');return;
    }
    if(field==='library-view'||field==='library-sort'){this.renderLibrary();return;}
    if(field==='playback-mode'){
      this.invalidate({pause:true});if(this.session&&this.songOnly())this.loadSongPlayback();
      this.tick(this.position||0);this.message(this.songOnly()?'Song only: listen and mark regions without assembling clips.':'Play will prepare the video and motion preview.');return;
    }
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
      this.message('Clip rating saved. Assembly combines ratings with recent-use weight. Reassemble to update clip choices.');return;
    }
    if(field==='volume'){this.player.audio.volume=Number(input.value);if(this.player.audio.volume>0)this.player.audio.muted=false;return;}
    if(field==='search')return;
    if(field==='seek'){this.setPosition(Number(input.value));return;}
    if(field==='tag'){this.catalog=await this.ipc('tag',{id:input.dataset.id,category:input.value});this.renderLibrary();this.renderInspector();return;}
    if(field==='song'){if(input.value&&this.discardOkay())this.newSong(this.catalog.songs.find(s=>s.id===input.value));return;}
    if(field==='saved'){
      if(!input.value||!this.discardOkay())return;const saved=await this.ipc('load',{id:input.value}),session=normalizeSectionNames(saved);validateSession(session);this.analysisGeneration++;this.invalidate({pause:true});this.session=session;this.revisions.set(session.id,session.revision);this.history=new History();this.selected=0;this.position=0;this.dirty=session.sections.some((s,i)=>s.label!==saved.sections[i].label);this.timeline.reset();this.loadSongPlayback();this.renderEditor();this.message(this.dirty?'Session restored. Default section names repaired; save to keep them.':'Session restored. Press Play to listen, or Prepare preview for video and motion.');return;
    }
    if(field==='output-preset'||field==='output-fit'){
      this.edit(s=>{const current=outputSettings(s);s.output=field==='output-preset'?{preset:input.value,fit:'cover'}:{preset:current.preset,fit:input.value};},{keepPlacements:true});
      this.message('Output framing updated. Prepare preview to review the crop before rendering.');return;
    }
    if(['name','bpm','blend_ms','repeat_policy'].includes(field)){this.edit(s=>{s[field]=['name','repeat_policy'].includes(field)?input.value:Number(input.value);},{keepPlacements:true});return;}
    if(field==='auto-min'||field==='auto-max'){
      this.edit(s=>{s.auto_clip={...(s.auto_clip||DEFAULT_AUTO_CLIPS),[field==='auto-min'?'min_ms':'max_ms']:Math.round(Number(input.value)*1000)};},{keepPlacements:true});
      this.message('Automatic clip range saved. Assemble updates automatic sections; manual cuts and kept clips stay in place.');return;
    }
    if(['source_in_ms','rate','clip_id'].includes(field)){
      this.edit(s=>{const p=s.placements.find(p=>p.id===this.selectedPlacement);if(!p)throw new Error('Select a clip on the timeline.');p[field]=field==='clip_id'?input.value:Number(input.value)*(field==='source_in_ms'?1000:1);delete s.asset_bindings;validateSession(s,this.catalog.clips);},{keepPlacements:true});return;
    }
    if(field==='end_ms'){
      this.regionEditor.commit(resizeSongSection(this.session,this.session.sections[this.selected].id,Math.round(Number(input.value)*1000),this.catalog.clips));return;
    }
    if(['category','motion','strength','label','locked'].includes(field)){
      this.edit(s=>{const section=s.sections[this.selected];section[field]=field==='locked'?input.checked:field==='strength'?Number(input.value):input.value;if(field==='label')section.auto_label=false;},{keepPlacements:field!=='category'});
    }
  }
  setPosition(time){if(!this.session)return;this.position=Math.max(0,Math.min(Math.round(time),this.session.song.duration_ms-1));void this.player.seek(this.position).catch(e=>this.message(e.message,true));this.tick(this.position);}
  async analyze(){
    if(this.busy)throw new Error('Wait for the current task.');this.busy=true;this.player.pause();const gen=++this.analysisGeneration,id=this.session.id;
    const bar=this.root.querySelector('progress'),cancel=this.root.querySelector('[data-action=cancel]');bar.hidden=false;cancel.hidden=false;
    try{
      this.message('Analyzing song energy and beats…');const file=await(await fetch(this.session.song.url)).blob();const {samples,sampleRate}=await decodeBeatAudio(file);
      const analysis=await analyzeBeatAudio(samples,sampleRate,{character:true,cancelled:()=>gen!==this.analysisGeneration,progress:value=>{bar.value=value;}});
      if(gen!==this.analysisGeneration||this.session.id!==id)return;
      this.edit(s=>{s.analysis=analysis;s.bpm=analysis.bpm||120;},{keepPlacements:true});
      this.message(`Analysis ready · ${analysis.bpm||'unknown'} BPM · ${Math.round(analysis.confidence*100)}% confidence. Adjust BPM and section boundaries as needed.`);
    }finally{this.busy=false;bar.hidden=true;cancel.hidden=true;this.musicEditor?.render();this.schedulePreviewRefresh();}
  }
  prepare({live=false}={}){
    if(!live)this.invalidate({pause:true});
    clearTimeout(this.previewRefreshTimer);this.previewRefreshPending=false;
    const generation=this.preparationGeneration,session=this.session,previous=this.preparationTask;
    // Selection-only edits keep an in-flight compilation valid: its media,
    // cuts and motion are unchanged, even though history clones the recipe.
    const context={session};this.preparationContext=context;
    const current=()=>this.session===context.session&&this.visible&&generation===this.preparationGeneration;
    this.preparing=true;this.refreshingPreview=live;
    const task=(async()=>{
      try{
        // Serialize requests, but discard stale results without changing mode
        // or reloading the song. Rapid edits compile only the latest state.
        await previous?.catch(()=>{});if(!current())return;
        if(!live)this.message('Compiling the session…');
        const prepared=await this.ipc('prepare',{session});if(!current())return;
        this.prepared=prepared;this.session.asset_bindings=prepared.asset_bindings;
        if(live){
          await this.player.updatePreview(prepared.snapshot,prepared.clips);
          if(current()&&this.player.snapshot!==prepared.snapshot){this.prepared=null;this.draw();return;}
        }else{
          this.root.querySelector('[data-field=playback-mode]').value='preview';
          await this.player.load(prepared.snapshot,prepared.clips,this.position||0);
        }
        if(!current())return;
        this.root.querySelector('.fc-preview-empty').hidden=true;this.draw();
        this.message(prepared.snapshot.warnings.length?prepared.snapshot.warnings.join(' · '):live?'Preview updated.':'Preview ready. Video, motion and audio share the song clock.');
      }catch(e){if(current()){this.prepared=null;throw e;}}
      finally{if(this.preparationTask===task){this.preparationTask=null;this.preparationContext=null;this.preparing=false;this.refreshingPreview=false;this.schedulePreviewRefresh();}}
    })();
    this.preparationTask=task;return task;
  }
  minimumRating(){return this.session ? this.session.min_rating??0 : this.defaultMinRating;}
  get includeDrafts(){return this.session ? this.session.include_drafts===true : this.defaultIncludeDrafts;}
  draftConflicts(){
    if(this.includeDrafts)return [];
    const drafts=new Set(this.catalog.clips.filter(isDraftClip).map(c=>c.id));
    return [...new Set((this.session?.placements||[]).filter(p=>drafts.has(p.clip_id)).map(p=>p.clip_id))];
  }
  ratingConflicts(){
    const clips=new Map(this.catalog.clips.map(c=>[c.id,c]));
    return [...new Set((this.session?.placements||[]).filter(p=>p.clip_id&&clipRating(clips.get(p.clip_id))<this.minimumRating()).map(p=>p.clip_id))];
  }
  renderLibrary(){
    const search=tagKey(this.root.querySelector('[data-field=search]').value),terms=search.split(' ').filter(Boolean);
    this.tagIndex=clipTagIndex(this.catalog.clips);
    this.sourceIndex=clipMetadataIndex(this.catalog.clips);
    const browseCount=sourceFilterCount(this.librarySourceFilters);
    this.root.querySelector('[data-action=library-sources]').textContent=`Browse source filters${browseCount?' · '+browseCount:''}`;
    const view=this.root.querySelector('[data-field=library-view]').value,sort=this.root.querySelector('[data-field=library-sort]').value,minimum=this.minimumRating();
    const roots=this.catalog.roots||[],pending=pendingLocalScripts(this.catalog.clips,{include_drafts:this.includeDrafts,min_rating:minimum});
    const offline=roots.filter(root=>this.catalog.root_status?.[root]?.available===false);
    this.root.querySelector('.fc-local-library').innerHTML=roots.length?`<details ${offline.length?'open':''}><summary>${roots.length} local folder${roots.length===1?'':'s'} indexed${offline.length?' · '+offline.length+' offline':''}</summary>${roots.map(root=>`<small>${esc(root)}${offline.includes(root)?' · Offline — reconnect the folder, then rescan':''}</small>`).join('')}<button data-action="rescan">Rescan local folders</button></details>`:'<p>No local folder indexed. Videos already on disk? Use <strong>＋ Folder</strong> to link them to HF.</p>';
    if(pending.length)this.root.querySelector('.fc-local-library').insertAdjacentHTML('beforeend',`<button data-action="fetch-scripts">Get HF scripts · ${pending.length} local video${pending.length===1?'':'s'}</button><small>Uses current rating/draft filters. Downloads scripts only.</small>`);
    this.root.querySelector('[data-field=min_rating]').value=String(minimum);
    this.root.querySelector('[data-field=drafts]').checked=this.includeDrafts;
    this.root.querySelector('.fc-library-filter-summary').textContent=`${minimum?minimum+'★+':'All ratings'} · drafts ${this.includeDrafts?'on':'off'}`;
    const draftCount=this.catalog.clips.filter(c=>!c.retired&&isDraftClip(c)).length,review=this.root.querySelector('.fc-dataset-review');
    review.hidden=!draftCount;
    review.textContent=`${this.catalog.dataset?.review_policy==='all-drafts'?'This dataset publishes all variants as unreviewed drafts. ':''}${draftCount} draft variant${draftCount===1?'':'s'} ${this.includeDrafts?'included before rating and availability filters.':'hidden from browsing and assembly. Enable Include draft scripts to use them.'}`;
    const draftConflicts=this.draftConflicts(),draftWarning=this.root.querySelector('.fc-draft-warning');draftWarning.hidden=!draftConflicts.length;
    draftWarning.textContent=`${draftConflicts.length} used draft clip${draftConflicts.length===1?' is':'s are'} excluded. Enable Include draft scripts, or unlock and replace them before preview or export. “Used in session” keeps them visible.`;
    const used=new Map();for(const p of this.session?.placements||[])if(p.clip_id)used.set(p.clip_id,(used.get(p.clip_id)||0)+1);
    const clips=this.catalog.clips.filter(c=>
      (view==='used'?used.has(c.id):!c.retired&&(this.includeDrafts||!isDraftClip(c))&&clipRating(c)>=minimum)&&
      (view!=='ready'||ready(c))&&(view!=='local'||c.available)&&(view!=='audio-sync'||isAudioSyncClip(c))&&matchesSourceFilters(c,{source_filters:this.librarySourceFilters},null,this.sourceIndex)&&terms.every(term=>tagKey(`${c.name} ${(c.categories||[]).join(' ')} ${(c.category_paths||[]).join(' ')} ${(this.tagIndex.get(c.id)||[]).join(' ')} ${Object.values(sourceValues(c,this.sourceIndex)).join(' ')} ${this.sourceIndex.get(c.id)?.post_id||''} ${(this.sourceIndex.get(c.id)?.civitai_metadata.model_version_ids||[]).join(' ')} ${isAudioSyncClip(c)?'audio sync':''}`).includes(term)))
      .sort((a,b)=>(sort==='rating'?clipRating(b)-clipRating(a):0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    const conflicts=this.ratingConflicts(),warning=this.root.querySelector('.fc-rating-warning');warning.hidden=!conflicts.length;
    warning.textContent=`${conflicts.length} used clip${conflicts.length===1?' is':'s are'} below ${minimum}★. Unlock affected sections and assemble again, or replace them. “Used in session” keeps these clips visible.`;
    const sourceConflicts=this.session?sourceFilterConflicts(this.session,this.catalog.clips,this.sourceIndex):[],sourceWarning=this.root.querySelector('.fc-source-warning');sourceWarning.hidden=!sourceConflicts.length;
    sourceWarning.textContent=`${sourceConflicts.length} placed region${sourceConflicts.length===1?' is':'s are'} outside the source filters. Current playback stays unchanged. Replace or reassemble to apply the filters; unlock affected kept clips first.`;
    this.root.querySelector('.fc-library-count').textContent=`${new Set(videoIdentities(clips).values()).size} unique videos · ${clips.length} catalog records · ${clips.filter(ready).length} records ready${clips.some(c=>!c.available)?' · '+clips.filter(c=>!c.available).length+' videos not linked / unavailable':''}${clips.some(c=>c.available&&!ready(c))?' · '+clips.filter(c=>c.available&&!ready(c)).length+' local videos need scripts':''}`;
    const empty=!this.catalog.clips.length?'Add a local folder or sync FunCiv Data.':view==='used'?'No used clips match. Assemble a session or clear the search.':draftCount&&!this.includeDrafts?'Enable draft scripts or adjust the rating and view filters.':'No clips match these filters.';
    this.clipLibrary.render(clips,used,minimum,empty);
  }

  renderOutput(){
    const output=outputSettings(this.session||{output:DEFAULT_OUTPUT});
    for(const key of ['preset','fit']){const input=this.root.querySelector(`[data-field=output-${key}]`);input.value=output[key];input.disabled=!this.session;}
    this.root.querySelector('.fc-preview-stage').style.setProperty('--fc-output-ratio',output.width/output.height);
    for(const video of this.root.querySelectorAll('.fc-preview video'))video.style.objectFit=output.fit;
  }
  renderEditor(){
    this.renderLibrary();this.renderOutput();this.musicEditor?.render();const s=this.session;if(!s)return;
    const pacing=s.auto_clip||DEFAULT_AUTO_CLIPS;
    this.root.querySelector('[data-field=auto-min]').value=pacing.min_ms/1000;this.root.querySelector('[data-field=auto-max]').value=pacing.max_ms/1000;
    this.selected=Math.min(this.selected,s.sections.length-1);
    if(!s.placements.some(p=>p.id===this.selectedPlacement&&p.section_id===s.sections[this.selected].id))this.selectedPlacement=null;
    this.root.querySelector('.fc-song-title').textContent=`${s.name} · ${stamp(s.song.duration_ms)}`;
    const tagCount=(s.tag_preferences?.prefer.length||0)+(s.tag_preferences?.less.length||0);
    this.root.querySelector('[data-action=session-tags]').textContent=`Session tags${tagCount?' · '+tagCount:''}`;
    const sourceCount=sourceFilterCount(s.source_filters);this.root.querySelector('[data-action=session-sources]').textContent=`Source filters${sourceCount?' · '+sourceCount:''}`;
    this.root.querySelector('[data-field=seek]').max=s.song.duration_ms;
    this.renderSections();this.regionEditor.renderTrack();
    this.root.querySelector('.fc-summary').textContent=`${s.sections.length} sections · ${s.placements.length} cuts · variation ${s.seed}${this.dirty?' · unsaved changes':''}`;
    this.renderInspector();this.draw();this.schedulePreviewRefresh();
  }
  renderSections(){
    const s=this.session;if(!s)return;
    const selectedSection=s.sections[this.selected],pool=sectionPoolLabel(selectedSection);
    this.root.querySelector('.fc-selection-bar').innerHTML=`<div><small>SELECTED SONG SECTION ${this.selected+1}</small><strong>${esc(selectedSection.label)}</strong><span>${stamp(selectedSection.start_ms)} – ${stamp(selectedSection.end_ms)}</span></div><div class="fc-actions"><button data-action="remake-section" ${selectedSection.locked?'disabled':''} title="Rebuild only this section. Try fresh footage; manual cuts and kept clips stay in place.">Remake section</button><button data-action="section-folders" data-id="${esc(selectedSection.id)}" title="Choose folders for this section">Folders: ${esc(pool)} <span>✎</span></button></div>`;
    this.root.querySelector('.fc-section-strip').innerHTML=s.sections.map((section,i)=>`<div class="fc-section-block ${i===this.selected?'fc-selected':''}" style="left:${section.start_ms/s.song.duration_ms*100}%;width:${(section.end_ms-section.start_ms)/s.song.duration_ms*100}%"><button data-action="select-section" data-index="${i}" title="Song section ${i+1}: ${esc(section.label)} · ${stamp(section.start_ms)}–${stamp(section.end_ms)}">${esc(section.label)}</button><button class="fc-section-folder" data-action="section-folders" data-id="${esc(section.id)}" title="Choose folders for ${esc(section.label)}">${esc(sectionPoolLabel(section))}</button></div>`).join('');
    this.root.querySelector('.fc-sections').innerHTML=s.sections.map((section,i)=>`<div class="fc-section-row ${i===this.selected?'fc-selected':''}" data-section="${i}"><button class="fc-section-select" data-action="select-section" data-index="${i}"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(section.label)}</strong><span>${stamp(section.start_ms)} – ${stamp(section.end_ms)}</span></button><button class="fc-folders-button" data-action="section-folders" data-id="${esc(section.id)}" title="Change folder choices">Folders: ${esc(sectionPoolLabel(section))}</button><span>${esc(policies.find(([id])=>id===section.motion)?.[1])}</span><span>${section.locked?'Locked':section.strength+'%'}</span></div>`).join('');
    this.root.querySelector('.fc-selection-bar>.fc-actions').insertAdjacentHTML('afterbegin',`<button data-action="section-tags" data-id="${esc(selectedSection.id)}" title="Optional tag preferences for this song section">${esc(sectionTagLabel(s,selectedSection))}</button>`);
    this.root.querySelector('.fc-selection-bar>.fc-actions').insertAdjacentHTML('afterbegin',`<button data-action="section-sources" data-id="${esc(selectedSection.id)}">${esc(sourceFilterLabel(s,selectedSection))}</button>`);
    this.sectionEditor.renderHandles();
  }
  renderInspector(){
    if(!this.session)return;const s=this.session,section=s.sections[this.selected];
    this.regionEditor.pauseSource();
    const sectionHTML=`<label>Section name<input data-field="label" value="${esc(section.label)}"></label><div class="fc-inspector-pool"><small>Clip pool</small><p>${esc(sectionPoolLabel(section))}</p><button data-action="section-folders" data-id="${esc(section.id)}">Choose folders &amp; categories</button></div><label>Motion<select data-field="motion">${options(policies,section.motion)}</select></label><label>Strength (%)<input data-field="strength" type="number" min="0" max="100" value="${section.strength}"></label><label>Section ends at (seconds)<input data-field="end_ms" type="number" step="0.001" value="${section.end_ms/1000}" ${this.selected===s.sections.length-1?'disabled':''}></label><label class="fc-check"><input data-field="locked" type="checkbox" ${section.locked?'checked':''}> Keep clips on variation</label>
      ${section.motion==='gaps'?`<div class="fc-gap"><h3>Marked motion gaps</h3><p>Only these ranges receive song motion.</p><label>Start (seconds)<input data-gap="start" type="number" step="0.01" value="${section.start_ms/1000}"></label><label>End (seconds)<input data-gap="end" type="number" step="0.01" value="${section.end_ms/1000}"></label><button data-action="mark-gap">Add gap</button><button data-action="clear-gaps">Clear</button><small>${section.gaps.map(([a,b])=>stamp(a)+'–'+stamp(b)).join(', ')||'No gaps marked'}</small></div>`:''}`;
    const clipMode=this.inspectorMode==='clip'&&!!this.regionEditor.selected();
    this.root.querySelector('.fc-inspector>h2').textContent=clipMode?'Clip region':'Section settings';
    this.root.querySelector('[data-action=inspector-clip]').disabled=!this.regionEditor.selected();
    for(const key of ['section','clip'])this.root.querySelector(`[data-action=inspector-${key}]`).classList.toggle('fc-active',clipMode===(key==='clip'));
    this.root.querySelector('.fc-inspector-content').innerHTML=clipMode?`<div class="fc-region-inspector"><small>Song section ${this.selected+1}: ${esc(section.label)}</small><button data-action="section-folders" data-id="${esc(section.id)}">Choose section folders</button>${this.regionEditor.inspectorHTML()}</div>`:sectionHTML;
    this.root.querySelector('.fc-inspector-pool')?.insertAdjacentHTML('beforeend',`<button data-action="section-tags" data-id="${esc(section.id)}">${esc(sectionTagLabel(s,section))}</button>`);
    this.root.querySelector('.fc-inspector-pool')?.insertAdjacentHTML('beforeend',`<button data-action="section-sources" data-id="${esc(section.id)}">${esc(sourceFilterLabel(s,section))}</button>`);
    this.regionEditor.bindSourcePreview();
    this.root.querySelector('.fc-session-settings').innerHTML=`<h2>Session</h2><label>Name<input data-field="name" value="${esc(s.name)}"></label><label>Video repeats<select data-field="repeat_policy">${options([['never','Never repeat a video'],['cycle','Reuse after matching videos are used']],s.repeat_policy||'never')}</select></label><small>Assembly offers matching drafts if they can fill a shortage. Kept clips are preserved. Recent use lowers selection weight to 20%; it recovers over five other completed compositions.</small><label>Song BPM<input data-field="bpm" type="number" min="30" max="300" value="${s.bpm||120}"></label><label>Motion blend (ms)<input data-field="blend_ms" type="number" min="0" max="2000" step="10" value="${s.blend_ms}"></label><p>Video uses clean cuts. Motion blends around each cut. Beat analysis is a starting point; sections remain editable.</p>`;
  }
  tick(time=0){
    if(this.session)this.position=time;
    this.previewControls?.tick(time);
    this.musicEditor?.tick(time);
    this.root.querySelector('.fc-playhead').style.left=`${Math.min(100,time/(this.session?.song.duration_ms||1)*100)}%`;
    this.timeline?.follow(time);
    if(this.devices.active)this.app.sessionTracker?.setPlayback({currentTime:time/1000,duration:this.session.song.duration_ms/1000,paused:this.player.audio.paused});
  }
  draw(){this.timeline?.draw();this.musicEditor?.draw();}
  credentials(){
    const dialog=document.createElement('dialog');dialog.className='fc-dialog';dialog.innerHTML=`<form method="dialog"><h2>Civitai access</h2><label>Site<select name="site">${options(['civitai.com','civitai.red','civitaired.com'].map(s=>[s,s]),this.site||'civitai.com')}</select></label><label>API key<input name="key" type="password" autocomplete="off" placeholder="Leave empty to keep the stored key"></label><p>The key stays in encrypted local storage. Videos are downloaded only when you resolve a selected clip.</p><div class="fc-actions"><button value="cancel">Cancel</button><button value="save">Save</button><button value="remove">Remove key</button></div></form>`;
    dialog.addEventListener('close',()=>{const value=dialog.querySelector('[name=key]').value;this.site=dialog.querySelector('[name=site]').value;dialog.querySelector('[name=key]').value='';const result=dialog.returnValue;dialog.remove();if(result==='remove'||(result==='save'&&value))void this.ipc('key',{value:result==='remove'?'':value}).then(()=>this.message('API settings saved.')).catch(e=>this.message(e.message,true));});
    this.root.append(dialog);dialog.showModal();
  }
}
