import { sourceTime } from '../../packages/composer-core/index.mjs';

/** Canonical song audio owns time. Two muted decoders prepare consecutive cuts.
 * Device previews can pause the clock when a decoder falls behind. Live editing
 * lets video catch up without interrupting the song or reloading its source.
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
  setSong(song) {
    this.pause(); this.song = song; this.snapshot = null; this.current = null; this.clips = new Map();this.keepAudioRunning=false;
    this.audio.src = song.url; this.audio.load();
    for (const v of this.videos) { v.pause(); v.removeAttribute('src'); v.dataset.placement = ''; v.hidden = true; v.load(); }
  }
  loadSong(song, position = 0) {
    this.setSong(song);
    return this.seek(position);
  }
  load(snapshot, clips, position = 0) {
    this.setSong({...snapshot.song, duration_ms:snapshot.duration_ms});
    this.snapshot = snapshot; this.clips = new Map(clips.map(c => [c.id,c]));
    return this.seek(position);
  }
  updatePreview(snapshot, clips) {
    if(snapshot.song.url!==this.song?.url)throw new Error('The preview belongs to another song.');
    this.detachPreview();this.keepAudioRunning=true;
    this.snapshot=snapshot;this.clips=new Map(clips.map(c=>[c.id,c]));
    return this.align(this.generation);
  }
  pause() { this.intent = false; this.generation++; this.audio.pause(); this.videos.forEach(v=>v.pause()); }
  detachPreview() {
    const gen=++this.generation;
    this.snapshot=null;this.current=null;this.aligning=null;
    for(const video of this.videos){video.pause();video.hidden=true;video.dataset.placement='';}
    // An unfinished preview alignment may have paused the audio temporarily.
    // Keep the same audio element, position and play intent while editing.
    if(this.intent&&this.audio.paused)void this.playAudio(gen).catch(e=>this.onError(e.message));
  }
  async play() {
    if (!this.song) throw new Error('Load a song first.');
    this.intent = true;
    if (this.audio.ended) this.audio.currentTime = 0;
    const gen = ++this.generation;
    if (this.snapshot) await this.align(gen); else await this.playAudio(gen);
  }
  async playAudio(gen) {
    try {
      await this.audio.play();
      if (gen !== this.generation && !this.intent) this.audio.pause();
    } catch (error) {
      if (gen === this.generation) { this.pause(); throw error; }
    }
  }
  async seek(ms) {
    const gen = ++this.generation;
    this.audio.pause(); this.videos.forEach(v=>v.pause());
    if (!this.song) return;
    this.audio.currentTime = Math.max(0,Math.min(ms,this.song.duration_ms-1))/1000;
    this.onTick(this.audio.currentTime*1000);
    if (this.snapshot) await this.align(gen); else if (this.intent) await this.playAudio(gen);
  }
  async ready(video, placement, time, gen=this.generation) {
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
    if(gen!==this.generation||video.dataset.placement!==placement.id)return false;
    video.playbackRate = placement.rate;
    const target = sourceTime(placement,time)/1000;
    if (Math.abs(video.currentTime-target)>.025) { video.currentTime=target; await wait('seeked',()=>!video.seeking); }
    if(gen!==this.generation||video.dataset.placement!==placement.id)return false;
    await wait('loadeddata',()=>video.readyState>=2);
    return gen===this.generation&&video.dataset.placement===placement.id;
  }
  async align(gen) {
    this.aligning = gen;
    try {
      const snapshot=this.snapshot;
      if(!snapshot||gen!==this.generation)return;
      const continuous=this.keepAudioRunning;
      const time=this.audio.currentTime*1000, p=snapshot.placements.find(p=>time>=p.start_ms&&time<p.end_ms);
      if(!p)return;
      if(!continuous)this.audio.pause();this.videos.forEach(v=>v.pause());
      let index=this.videos.findIndex(v=>v.dataset.placement===p.id); if(index<0)index=1-this.active;
      const video=this.videos[index]; if(!await this.ready(video,p,time,gen))return;
      if(gen!==this.generation)return;
      if(continuous){
        // Loading metadata may span a cut. Let the next tick select the new
        // clip; otherwise seek to the audio's current position before showing.
        const now=this.audio.currentTime*1000;
        if(now<p.start_ms||now>=p.end_ms){this.current=null;return;}
        if(Math.abs(video.currentTime-sourceTime(p,now)/1000)>.08){
          if(!await this.ready(video,p,now,gen))return;
        }
      }
      this.active=index;this.current=p;this.videos.forEach((v,i)=>{v.hidden=i!==index;});
      if(this.intent){await video.play();if(gen!==this.generation){if(!this.intent||video.hidden)video.pause();return;}if(!continuous||this.audio.paused)await this.playAudio(gen);if(gen!==this.generation){if(!this.intent||video.hidden)video.pause();return;}}
      const next=snapshot.placements[snapshot.placements.indexOf(p)+1];
      if(next)this.ready(this.videos[1-index],next,next.start_ms,gen).catch(()=>{});
    } catch(e) {if(gen===this.generation){if(this.keepAudioRunning)this.detachPreview();else this.pause();this.onError(e.message);}}
    finally { if(this.aligning===gen)this.aligning=null; this.onTick(this.audio.currentTime*1000); }
  }
  tick() {
    const time=this.song?this.audio.currentTime*1000:0;this.onTick(time);
    if(!this.song)return;
    if(!this.snapshot||!this.intent||this.aligning)return;
    const video=this.videos[this.active];
    if(!this.current||time<this.current.start_ms||time>=this.current.end_ms||video.readyState<2||Math.abs(video.currentTime-sourceTime(this.current,time)/1000)>.16)
      void this.align(++this.generation);
  }
  destroy(){this.pause();clearInterval(this.timer);}
}
