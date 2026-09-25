const stamp=ms=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(1).padStart(4,'0')}`;
const setText=(element,text)=>{if(element.textContent!==text)element.textContent=text;};

export const PLAYER_MARKUP=`<section class="fc-player" aria-label="Composition player">
  <div class="fc-player-heading"><div class="fc-now-playing"><small>SESSION PREVIEW</small><strong data-player-title>Load a song to begin</strong></div><div class="fc-player-tools"><button data-action="prepare" title="Compile video and motion for the current arrangement">Prepare preview</button><button data-action="fullscreen" aria-label="Enter fullscreen" title="Fullscreen (F)">⛶ Fullscreen</button></div></div>
  <div class="fc-preview-stage" tabindex="0" aria-label="Video preview. Click to play or pause; double-click for fullscreen."><div class="fc-preview"><video muted playsinline preload="auto" hidden></video><video muted playsinline preload="auto" hidden></video><div class="fc-preview-empty"><strong data-preview-empty-title>Load a song to begin</strong><small data-preview-empty-detail>Your assembled clips will play here.</small></div></div><span class="fc-preview-label">Preview</span></div>
  <audio preload="auto"></audio>
  <div class="fc-transport">
    <div class="fc-player-progress"><output class="fc-time">0:00.0</output><input data-field="seek" type="range" min="0" max="1" value="0" step="1" aria-label="Session position"><output class="fc-duration">0:00.0</output></div>
    <div class="fc-player-buttons"><div class="fc-playback-buttons"><button data-action="seek-back" aria-label="Back 10 seconds" title="Back 10 seconds">−10 s</button><button data-action="play" class="fc-primary fc-play-button" aria-label="Play or pause song">▶ Play</button><button data-action="seek-forward" aria-label="Forward 10 seconds" title="Forward 10 seconds">+10 s</button><button data-action="stop" title="Stop and return to the start">Stop</button></div><div class="fc-playback-options"><label class="fc-playback-mode">Playback<select data-field="playback-mode"><option value="song">Song only</option><option value="preview">Video + motion preview</option></select></label><div class="fc-player-volume"><button data-action="mute" aria-label="Mute audio" title="Mute (M)" aria-pressed="false">Mute</button><input data-field="volume" type="range" min="0" max="1" value="0.7" step="0.05" aria-label="Volume"></div></div></div>
  </div>
  <div class="fc-device-bar"><div class="fc-device-status" role="status"><span class="fc-device-dot" aria-hidden="true"></span><div><strong data-device-status>No device connected</strong><small data-device-help>Connect Handy or another device for live sync.</small></div></div><div class="fc-device-actions"><button data-action="connections">Connect device</button><button data-action="devices" class="fc-primary" disabled>Prepare device sync</button></div></div>
  <div class="fc-player-notice" role="status" hidden></div>
</section>`;

export function connectedDeviceNames(app){
  return [app.handyManager?.connected&&'Handy',app.autoblowManager?.connected&&'Autoblow',app.tcodeManager?.connected&&'TCode',
    app.buttplugManager?.connected&&app.buttplugManager.devices?.length&&'Buttplug'].filter(Boolean);
}

export function previewDeviceStatus(view){
  const names=connectedDeviceNames(view.app),name=names.join(' + '),connected=names.length>0;
  if(view.devicePreparing)return {state:'preparing',title:'Preparing device sync…',help:'Preparing the current motion script.',connected};
  if(!connected)return {state:'off',title:'No device connected',help:'Connect Handy or another device for live sync.',connected};
  if(view.devices.active)return {state:'ready',title:`${name} · ${view.player.intent?'Sync enabled':'Sync ready'}`,help:view.player.intent?'Following the song clock.':'Press Play to start video and motion together.',connected};
  return {state:'connected',title:`${name} connected`,help:'Prepare device sync, then press Play.',connected};
}

/** Fullscreen owns the whole player, keeping its audio clock, decoders and controls. */
export class PreviewControls {
  constructor(view){
    this.view=view;this.document=view.root.ownerDocument;this.root=view.root.querySelector('.fc-player');
    this.stage=this.root.querySelector('.fc-preview-stage');
    this.fields=Object.fromEntries(['player-title','preview-empty-title','preview-empty-detail','device-status','device-help'].map(name=>[name,this.root.querySelector(`[data-${name}]`)]));
    this.buttons=Object.fromEntries(['play','stop','seek-back','seek-forward','mute','prepare','devices','connections','fullscreen'].map(name=>[name,this.root.querySelector(`[data-action=${name}]`)]));
    this.seek=this.root.querySelector('[data-field=seek]');this.volume=this.root.querySelector('[data-field=volume]');
    this.elapsed=this.root.querySelector('.fc-time');this.duration=this.root.querySelector('.fc-duration');
    this.label=this.root.querySelector('.fc-preview-label');this.deviceStatus=this.root.querySelector('.fc-device-status');
    this.notice=this.root.querySelector('.fc-player-notice');
    this.resize=new ResizeObserver(()=>this.resizeFrame());this.resize.observe(this.stage);
    this.document.addEventListener('fullscreenchange',()=>this.fullscreenChanged());
    this.stage.addEventListener('click',()=>{
      clearTimeout(this.clickTimer);
      this.clickTimer=setTimeout(()=>{if(view.visible&&view.session)void view.action('play').catch(e=>view.message(e.message,true));},250);
    });
    this.stage.addEventListener('dblclick',()=>{
      clearTimeout(this.clickTimer);void this.toggleFullscreen().catch(e=>view.message(e.message,true));
    });
    this.volume.addEventListener('input',()=>{void view.change(this.volume);this.tick(view.position||0);});
    this.seekPointer=null;this.seekFromInput=false;
    this.seek.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.isPrimary===false||this.seek.disabled)return;
      this.seekPointer=event.pointerId;this.seekFromInput=false;
    });
    this.seek.addEventListener('input',()=>{
      this.seekFromInput=true;view.setPosition(Number(this.seek.value));
    });
    this.seek.addEventListener('change',event=>{
      // Native ranges emit change on release, after input has already sought.
      // Keep the delegated form handler from seeking a second time.
      event.stopPropagation();
      if(!this.seekFromInput)view.setPosition(Number(this.seek.value));
      this.seekFromInput=false;
    });
    const release=event=>{if(event.pointerId===this.seekPointer)this.seekPointer=null;};
    this.document.defaultView.addEventListener('pointerup',release,true);
    this.document.defaultView.addEventListener('pointercancel',release,true);
    this.seek.addEventListener('lostpointercapture',release);
    this.document.defaultView.addEventListener('blur',()=>this.endScrub());
    this.tick(0);
  }
  get fullscreen(){return this.document.fullscreenElement===this.root;}
  resizeFrame(){this.stage.style.setProperty('--fc-frame-height',`${Math.max(1,this.stage.clientHeight-2)}px`);}
  async toggleFullscreen(){
    if(this.fullscreen)await this.document.exitFullscreen();
    else{
      await this.root.requestFullscreen();
      if(!this.view.visible&&this.fullscreen)await this.document.exitFullscreen();
    }
  }
  async openConnections(){
    // FunSync's panel follows the fullscreen element itself. Opening it in
    // place preserves both the player and the panel's keyboard focus.
    this.view.app.connectionPanel?.show();
  }
  fullscreenChanged(){
    const full=this.fullscreen;
    setText(this.buttons.fullscreen,full?'⛶ Exit fullscreen':'⛶ Fullscreen');
    this.buttons.fullscreen.setAttribute('aria-label',full?'Exit fullscreen':'Enter fullscreen');
    this.buttons.fullscreen.title=full?'Exit fullscreen (Esc or F)':'Fullscreen (F)';
    this.resizeFrame();
    if(this.wasFullscreen&&!full&&this.view.visible&&!this.view.app.connectionPanel?._visible)this.buttons.fullscreen.focus({preventScroll:true});
    this.wasFullscreen=full;
  }
  hide(){
    clearTimeout(this.clickTimer);this.endScrub();
    if(this.fullscreen)void this.document.exitFullscreen().catch(()=>{});
  }
  endScrub(){this.seekPointer=null;this.seekFromInput=false;}
  message(text,error){
    setText(this.notice,text);this.notice.hidden=!error;this.notice.classList.toggle('fc-error',error);
  }
  tick(time){
    const v=this.view,s=v.session,audio=v.player.audio,songOnly=v.songOnly(),updating=v.previewRefreshPending||v.refreshingPreview;
    setText(this.fields['player-title'],s?.name||'Load a song to begin');
    if(!s)this.endScrub();
    // The native thumb owns its value until release; the playback timer must
    // not move it between pointer events, even while decoding a new frame.
    if(this.seekPointer===null)this.seek.value=time;
    const shownTime=this.seekPointer===null?time:Number(this.seek.value);
    setText(this.elapsed,stamp(shownTime));setText(this.duration,stamp(s?.song.duration_ms||0));
    this.seek.style.setProperty('--fc-progress',`${s?Math.min(100,shownTime/s.song.duration_ms*100):0}%`);
    this.seek.disabled=!s;
    for(const name of ['play','stop','seek-back','seek-forward','prepare'])this.buttons[name].disabled=!s;
    this.buttons.play.disabled=!s||!!v.devicePreparing;
    this.buttons.play.setAttribute('aria-label',v.player.intent?'Pause playback':'Play playback');
    setText(this.buttons.play,v.player.intent?'Ⅱ Pause':'▶ Play');
    const muted=audio.muted||audio.volume===0;
    setText(this.buttons.mute,muted?'Unmute':'Mute');this.buttons.mute.setAttribute('aria-pressed',String(muted));
    this.buttons.mute.setAttribute('aria-label',muted?'Unmute audio':'Mute audio');
    setText(this.label,songOnly?'Song only':updating?'Updating preview…':v.prepared?(v.player.intent?'Playing preview':'Preview ready'):'Preview needs preparation');
    setText(this.fields['preview-empty-title'],!s?'Load a song to begin':songOnly?'Song only':updating?'Updating preview…':'Your session preview');
    setText(this.fields['preview-empty-detail'],!s?'Your assembled clips will play here.':songOnly?'Switch Playback to Video + motion preview to watch your clips.':updating?'The song keeps its place while your changes are prepared.':'Assemble your clips, then press Play.');
    const status=previewDeviceStatus(v);this.deviceStatus.dataset.state=status.state;
    setText(this.fields['device-status'],status.title);setText(this.fields['device-help'],status.help);
    setText(this.buttons.connections,status.connected?'Device settings':'Connect device');
    setText(this.buttons.devices,v.devicePreparing?'Preparing…':v.devices.active?'Release device sync':'Prepare device sync');
    this.buttons.devices.disabled=!s||!status.connected&&!v.devices.active||!!v.devicePreparing;
    this.buttons.devices.setAttribute('aria-busy',String(!!v.devicePreparing));
  }
}
