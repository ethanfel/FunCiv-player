import { sourceTime } from '../../packages/composer-core/index.mjs';

/** Canonical song audio owns time. Two muted decoders prepare consecutive cuts.
 * If a decoder falls behind, pause the audio clock (and therefore device sync).
 * A generation token prevents a pending seek/play from undoing a later pause.
 */
export class CompositionPlayer {
  constructor(audio, videos, onTick, onError) {
    this.audio = audio; this.videos = videos; this.onTick = onTick; this.onError = onError;
    this.generation = 0; this.intent = false; this.active = 0; this.current = null;
    this.timer = setInterval(() => this.tick(), 30);
    audio.addEventListener('ended', () => this.pause());
    audio.addEventListener('error', () => { this.pause(); this.onError('The song cannot be played. Import it again.'); });
    this.wrapper = { video: audio, get currentTime(){return audio.currentTime;}, get duration(){return audio.duration;},
      get paused(){return audio.paused;}, get playbackRate(){return audio.playbackRate;} };
  }
  load(snapshot, clips) {
    this.pause(); this.snapshot = snapshot; this.clips = new Map(clips.map(c => [c.id,c])); this.current = null;
    this.audio.src = snapshot.song.url; this.audio.load();
    for (const v of this.videos) { v.pause(); v.removeAttribute('src'); v.dataset.placement = ''; v.load(); }
    return this.seek(0);
  }
  pause() { this.intent = false; this.generation++; this.audio.pause(); this.videos.forEach(v=>v.pause()); }
  async play() {
    if (!this.snapshot) throw new Error('Prepare the session first.');
    this.intent = true;
    if (this.audio.ended) this.audio.currentTime = 0;
    await this.align(++this.generation);
  }
  async seek(ms) {
    const gen = ++this.generation;
    this.audio.pause(); this.videos.forEach(v=>v.pause());
    this.audio.currentTime = Math.max(0,Math.min(ms,this.snapshot.duration_ms-1))/1000;
    await this.align(gen);
  }
  async ready(video, placement, time) {
    if (video.dataset.placement !== placement.id) {
      video.dataset.placement = placement.id; video.src = this.clips.get(placement.clip_id).url; video.load();
    }
    const wait = (event, okay) => new Promise((resolve,reject)=>{
      if(okay()) { resolve(); return; }
      const done=()=>{cleanup();resolve();}, fail=()=>{cleanup();reject(new Error('A clip cannot be decoded. Export it or choose another file.'));};
      const timer=setTimeout(fail,12000);
      const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',fail);};
      video.addEventListener(event,done,{once:true});video.addEventListener('error',fail,{once:true});
    });
    await wait('loadedmetadata',()=>video.readyState>=1);
    if(video.dataset.placement!==placement.id)return false;
    video.playbackRate = placement.rate;
    const target = sourceTime(placement,time)/1000;
    if (Math.abs(video.currentTime-target)>.025) { video.currentTime=target; await wait('seeked',()=>!video.seeking); }
    if(video.dataset.placement!==placement.id)return false;
    await wait('loadeddata',()=>video.readyState>=2);
    return video.dataset.placement===placement.id;
  }
  async align(gen) {
    this.aligning = gen;
    try {
      const time=this.audio.currentTime*1000, p=this.snapshot.placements.find(p=>time>=p.start_ms&&time<p.end_ms);
      if(!p)return;
      this.audio.pause(); this.videos.forEach(v=>v.pause());
      let index=this.videos.findIndex(v=>v.dataset.placement===p.id); if(index<0)index=1-this.active;
      const video=this.videos[index]; if(!await this.ready(video,p,time))return;
      if(gen!==this.generation)return;
      this.active=index;this.current=p;this.videos.forEach((v,i)=>{v.hidden=i!==index;});
      if(this.intent){await video.play();if(gen!==this.generation){video.pause();return;}await this.audio.play();if(gen!==this.generation){this.audio.pause();video.pause();return;}}
      const next=this.snapshot.placements[this.snapshot.placements.indexOf(p)+1];
      if(next)this.ready(this.videos[1-index],next,next.start_ms).catch(()=>{});
    } catch(e) {if(gen===this.generation){this.pause();this.onError(e.message);}}
    finally { if(this.aligning===gen)this.aligning=null; this.onTick(this.audio.currentTime*1000); }
  }
  tick() {
    if(!this.snapshot)return;
    const time=this.audio.currentTime*1000;this.onTick(time);
    if(!this.intent||this.aligning)return;
    const video=this.videos[this.active];
    if(!this.current||time>=this.current.end_ms||video.readyState<2||Math.abs(video.currentTime-sourceTime(this.current,time)/1000)>.16)
      void this.align(++this.generation);
  }
  destroy(){this.pause();clearInterval(this.timer);}
}
