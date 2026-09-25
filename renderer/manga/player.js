/** Stable device event source across two video decoders and motion-only holds. */
export class MangaPlayer {
  constructor(videos,{onChange=()=>{},onError=()=>{},onEnd=()=>{},onTransition=()=>{}}={}){
    this.videos=videos;this.onChange=onChange;this.onError=onError;this.onEnd=onEnd;this.onTransition=onTransition;this.artwork=new Map();this.generation=0;this.index=0;this.active=0;this.intent=false;this.running=false;this.position=0;this.volume=.8;this.bubbles=true;
    const clock=new EventTarget(),self=this;
    for(const [key,get] of Object.entries({currentTime:()=>self.position/1000,duration:()=>self.run?.duration_ms/1000||0,paused:()=>!self.running||!self.segment?.motion,playbackRate:()=>1,seeking:()=>!!self.switching,ended:()=>self.position>=self.run?.duration_ms}))Object.defineProperty(clock,key,{get});
    clock.pause=()=>self.pause();clock.play=()=>self.play();this.clock=clock;
    this.wrapper={video:clock,get currentTime(){return clock.currentTime;},get duration(){return clock.duration;},get paused(){return clock.paused;},get playbackRate(){return 1;}};
    for(const video of videos){
      video.loop=false;video.crossOrigin='anonymous';
      video.addEventListener('waiting',()=>{if(video===this.video&&!this.switching&&this.intent&&this.usesVideoClock)this.freeze();});
      video.addEventListener('seeking',()=>{if(video===this.video&&!this.switching&&this.intent&&this.usesVideoClock)this.freeze();});
      video.addEventListener('playing',()=>{if(video===this.video&&!this.switching&&this.intent&&this.usesVideoClock)this.resumeClock();});
      video.addEventListener('ended',()=>{if(video===this.video&&!this.switching&&this.intent&&this.usesVideoClock)void this.finish().catch(e=>this.fail(e));});
      video.addEventListener('error',()=>{if(video===this.video&&!this.switching&&this.usesVideoClock)this.fail(new Error('The panel video cannot be played. Refresh or relink the book.'));});
    }
    this.timer=setInterval(()=>this.tick(),25);
  }
  get video(){return this.videos[this.active];}
  get segment(){return this.run?.segments[this.index];}
  get usesVideoClock(){return ['video','loop'].includes(this.segment?.kind);}
  emit(name){this.clock.dispatchEvent(new Event(name));}
  notify(){this.onChange({segment:this.segment,position:this.position,playing:this.intent,running:this.running,holding:this.holding,index:this.index,switching:this.switching});}
  freeze(){if(this.running){this.running=false;this.emit('pause');}this.notify();}
  resumeClock(){if(!this.intent)return;this.anchor=performance.now();this.anchorPosition=this.position;const was=this.running;this.running=true;if(!was&&this.segment?.motion)this.emit('playing');this.notify();}
  pause(){this.intent=false;this.exitAtBoundary=false;this.generation++;this.switching=false;this.freeze();for(const v of this.videos)v.pause();this.notify();}
  fail(error){this.pause();this.onError(error.message);}
  async load(run,panelId,localMs=0){this.pause();this.run=run;const index=Math.max(0,run.segments.findIndex(s=>s.panelId===panelId));if(!run.segments.length){this.position=0;this.notify();return;}await this.select(index,localMs,false);}
  source(s){return s.bubbleLayers===undefined&&!s.overlay&&this.bubbles&&s.baked?s.baked:s.media;}
  async ready(video,url,time,gen,signal){
    const valid=()=>!signal?.aborted&&(typeof gen==='function'?gen():gen===this.generation)&&video.getAttribute('src')===url;
    const wait=(event,okay)=>new Promise((resolve,reject)=>{
      if(signal?.aborted)return reject(new Error('Preload cancelled.'));if(okay())return resolve();const timeout=setTimeout(()=>done(new Error('Timed out loading the panel video.')),15000);
      const done=e=>{clearTimeout(timeout);video.removeEventListener(event,success);video.removeEventListener('error',failure);signal?.removeEventListener('abort',cancel);e?reject(e):resolve();};
      const success=()=>done(),failure=()=>done(new Error('This video could not be decoded.')),cancel=()=>done(new Error('Preload cancelled.'));signal?.addEventListener('abort',cancel,{once:true});video.addEventListener(event,success,{once:true});video.addEventListener('error',failure,{once:true});
    });
    if(video.getAttribute('src')!==url){video.src=url;video.load();}
    await wait('loadedmetadata',()=>video.readyState>=1);if(!valid())return false;
    const target=Math.max(0,Math.min(time,Math.max(0,video.duration-.025)));
    if(Math.abs(video.currentTime-target)>.015){video.currentTime=target;await wait('seeked',()=>!video.seeking&&Math.abs(video.currentTime-target)<.08);}
    if(!valid())return false;
    await wait('loadeddata',()=>video.readyState>=2);return valid();
  }
  async select(index,localMs=0,playing=this.intent){
    if(!this.run?.segments[index])return;
    if(this.presentedPanel&&this.presentedPanel!==this.run.segments[index].panelId)this.onTransition('begin');
    this.freeze();for(const v of this.videos)v.pause();const gen=++this.generation;this.switching=true;this.exitAtBoundary=false;this.intent=playing;this.holding=false;this.index=index;
    const s=this.segment,local=Math.max(0,Math.min(localMs,s.duration));this.position=s.start+local;
    if(s.kind==='video'&&local===0&&s.settings.readBefore){playing=false;this.intent=false;}
    try{
      const artwork=this.warmArtwork(s);
      if(s.kind==='still'){
        const images=await artwork;if(gen!==this.generation)return;this.currentArtwork=images;
        this.switching=false;this.holding=s.settings.stillSeconds===0;this.intent=playing&&!this.holding;
        this.videos.forEach(v=>v.hidden=true);this.presentedPanel=s.panelId;this.emit('seeked');this.notify();this.onTransition('ready');
        if(this.intent)this.resumeClock();this.preload();return;
      }
      const url=this.source(s),next=this.warmTask?.url===url?this.videos.indexOf(this.warmTask.video):this.videos.findIndex(v=>v.getAttribute('src')===url);
      this.active=next>=0?next:1-this.active;const video=this.video;
      const time=s.kind==='extension'?Math.max(0,(s.videoDuration||s.sourceStart+s.duration)/1000-.03):local/1000;
      if(this.warmTask?.video===video)this.cancelWarm();
      if(!await this.ready(video,url,time,gen))return;const images=await artwork;if(gen!==this.generation)return;this.currentArtwork=images;
      this.videos.forEach(v=>v.hidden=v!==video);this.applyVolume();this.switching=false;this.presentedPanel=s.panelId;this.emit('seeked');this.notify();this.onTransition('ready');
      if(playing)await this.startCurrent(gen);
      this.preload();
    }catch(e){if(gen===this.generation){this.switching=false;this.onTransition('cancel');this.fail(e);throw e;}}
  }
  async startCurrent(gen=this.generation){
    if(gen!==this.generation||!this.intent)return;
    if(!this.usesVideoClock){this.resumeClock();return;}
    if(typeof AudioContext!=='undefined'){
      if(!this.audioContext){this.audioContext=new AudioContext();this.gains=this.videos.map(v=>{const source=this.audioContext.createMediaElementSource(v),gain=this.audioContext.createGain();source.connect(gain);gain.connect(this.audioContext.destination);return gain;});}
      await this.audioContext.resume();this.applyVolume();
    }
    if(gen!==this.generation||!this.intent)return;
    const video=this.video;try{await video.play();}catch(error){if(gen!==this.generation||!this.intent)return;throw error;}if(gen!==this.generation){if(!this.intent)video.pause();return;}this.resumeClock();
  }
  async play(){if(!this.segment)return;if(this.segment.kind==='still'&&this.segment.settings.stillSeconds===0){this.holding=true;this.notify();return;}if(this.holding||this.position>=this.segment.end-20)return this.select(this.index,0,true);this.intent=true;this.holding=false;await this.startCurrent();}
  async seek(ms){const playing=this.intent;let i=this.run.segments.findIndex(s=>ms>=s.start&&ms<s.end);if(i<0)i=this.run.segments.length-1;return this.select(i,Math.max(0,ms-this.run.segments[i].start),playing);}
  async seekPanel(ms){const s=this.segment;if(!s)return;return this.select(this.index,Math.min(ms,s.duration),this.intent);}
  async next(immediate=false){
    if(this.segment?.kind==='extension'&&this.intent&&!immediate){this.exitAtBoundary=true;this.notify();return;}
    const id=this.segment?.panelId,index=this.run?.segments.findIndex((s,i)=>i>this.index&&s.panelId!==id);
    if(index>=0)return this.select(index,0,true);this.pause();this.onEnd({advancePage:true});
  }
  async previous(){const id=this.segment?.panelId;let index=this.index-1;while(index>=0&&this.run.segments[index].panelId===id)index--;if(index<0)return this.select(0,0,false);const target=this.run.segments[index].panelId;while(index>0&&this.run.segments[index-1].panelId===target)index--;return this.select(index,0,this.intent);}
  async finish(){
    if(this.finishing||!this.segment)return;this.finishing=true;
    try{const s=this.segment;this.position=s.end;this.freeze();
      if(this.exitAtBoundary){this.exitAtBoundary=false;await this.next(true);return;}
      if(!s.groupEnd&&this.run.segments[this.index+1]?.panelId===s.panelId){await this.select(this.index+1,0,true);return;}
      const hold=s.settings.autoplay==='manual'||(s.kind==='still'?s.settings.stillSeconds===0:s.settings.mode==='pause'||(s.settings.mode!=='none'&&s.settings.advance==='manual'));
      if(hold){this.pause();this.holding=true;this.notify();return;}
      if(this.run.segments[this.index+1])await this.select(this.index+1,0,true);
      else{this.pause();this.emit('ended');this.onEnd();}
    }finally{this.finishing=false;}
  }
  tick(){if(!this.intent||!this.running||this.switching||!this.segment)return;
    const s=this.segment;this.position=this.usesVideoClock?s.start+this.video.currentTime*1000:this.anchorPosition+performance.now()-this.anchor;
    this.position=Math.min(this.position,s.end);if(s.settings.edgeFades)this.applyVolume();this.notify();if(this.position>=s.end-8)void this.finish().catch(e=>this.fail(e));
  }
  warmImage(url){
    if(!url||typeof Image==='undefined')return Promise.resolve();
    if(this.artwork.has(url))return this.artwork.get(url).promise;
    const img=new Image();img.crossOrigin='anonymous';img.src=url;
    const promise=img.decode().then(()=>img).catch(()=>null);this.artwork.set(url,{img,promise});
    while(this.artwork.size>12)this.artwork.delete(this.artwork.keys().next().value);
    return promise;
  }
  async warmArtwork(s,prefetch=false){const urls=[...new Set([s?.static,s?.staticClean,s?.overlay,s?.poster,...(s?.bubbleLayers||[]).map(r=>r.image)].filter(Boolean))].slice(0,prefetch?8:260);return new Map(await Promise.all(urls.map(async url=>[url,await this.warmImage(url)])));}
  setAheadRun(run){this.aheadRun=run;this.preload();}
  cancelWarm(){this.warmTask?.controller.abort();this.warmTask=null;}
  clearAhead(){this.aheadRun=null;this.cancelWarm();}
  preload(){
    if(this.switching)return;
    const upcoming=[...(this.run?.segments.slice(this.index+1)||[]),...(this.aheadRun?.segments||[])];
    const seen=new Set();for(const item of upcoming){if(seen.has(item.panelId))continue;seen.add(item.panelId);void this.warmArtwork(item,true);if(seen.size===3)break;}
    const next=upcoming.find(s=>s.media&&(!this.usesVideoClock||this.source(s)!==this.video.getAttribute('src')));
    if(!next)return;
    const video=this.videos[1-this.active],url=this.source(next);
    if(this.warmTask?.video===video&&this.warmTask.url===url)return;
    this.cancelWarm();const task={video,url,controller:new AbortController()};this.warmTask=task;
    video.pause();video.muted=true;video.preload='auto';
    task.promise=this.ready(video,url,0,()=>this.warmTask===task&&video!==this.video,task.controller.signal).catch(()=>false);
  }
  applyVolume(){const s=this.segment;if(!s)return;const local=this.position-s.start,fade=s.settings.edgeFades&&s.kind!=='extension'?Math.max(0,Math.min(1,local/80,(s.duration-local)/80)):1,gain=this.volume*(s.settings.gain??1)*fade;if(this.gains){this.video.volume=1;this.gains[this.active].gain.value=gain;}else this.video.volume=Math.min(1,gain);this.video.muted=s.kind==='extension'||(s.kind==='loop'&&!s.settings.repeatAudio);}
  setVolume(value){this.volume=value;this.applyVolume();}
  async setBubbles(value){this.bubbles=value;if(this.segment&&this.segment.kind!=='still'&&!this.segment.overlay&&this.source(this.segment)!==this.video.getAttribute('src'))await this.select(this.index,this.position-this.segment.start,this.intent);this.preload();this.notify();}
  destroy(){this.clearAhead();this.artwork.clear();this.currentArtwork=null;this.pause();clearInterval(this.timer);void this.audioContext?.close();for(const v of this.videos){v.removeAttribute('src');v.load();}}
}
