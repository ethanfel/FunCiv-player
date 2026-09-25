import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositionPlayer } from '../../renderer/composer/composition-player.js';
import { ComposerDeviceSession } from '../../renderer/composer/device-session.js';

class Media extends EventTarget {
  constructor(){super();this.currentTime=0;this.duration=4;this.readyState=4;this.paused=true;this.dataset={};this.seeking=false;}
  load(){} removeAttribute(){} pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
  async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}
}
const snapshot={session_id:'s',song:{url:'file:///synthetic.wav',name:'test'},duration_ms:4000,
  scripts:{L0:{actions:[{at:0,pos:50},{at:4000,pos:50}]},R0:{actions:[{at:0,pos:20},{at:4000,pos:80}]}},
  placements:[{id:'p0',clip_id:'c',start_ms:0,end_ms:2000,source_in_ms:100,rate:1},{id:'p1',clip_id:'c',start_ms:2000,end_ms:4000,source_in_ms:0,rate:1}]};
test('song playback and seeking need no clips or motion; preview uses the selected song position',async()=>{
  const audio=new Media(),videos=[new Media(),new Media()],ticks=[];
  const player=new CompositionPlayer(audio,videos,time=>ticks.push(time),()=>{});
  try{
    await player.loadSong({...snapshot.song,duration_ms:4000});
    assert.equal(player.snapshot,null);assert.ok(videos.every(v=>v.paused&&v.hidden));
    await player.seek(1500);assert.equal(audio.currentTime,1.5);assert.ok(audio.paused);
    await player.play();assert.equal(audio.paused,false);assert.ok(videos.every(v=>v.paused));
    audio.currentTime=1.8;player.tick();assert.equal(ticks.at(-1),1800);
    await player.seek(2500);assert.equal(audio.currentTime,2.5);assert.equal(audio.paused,false);
    player.pause();await player.seek(0);assert.equal(audio.currentTime,0);assert.ok(audio.paused);
    await player.load(snapshot,[{id:'c',url:'file:///synthetic.mp4'}],2500);
    assert.equal(player.current.id,'p1');assert.equal(videos[player.active].currentTime,.5);assert.ok(audio.paused);
    await player.loadSong({...snapshot.song,duration_ms:4000},2500);
    assert.equal(player.snapshot,null);assert.equal(audio.currentTime,2.5);assert.ok(videos.every(v=>v.paused&&v.hidden));
  }finally{player.destroy();}
});
test('a pending song-only play cannot resume after pause or song replacement',async()=>{
  const audio=new Media(),player=new CompositionPlayer(audio,[new Media(),new Media()],()=>{},()=>{});
  try{
    await player.loadSong({...snapshot.song,duration_ms:4000});
    let release;audio.play=()=>new Promise(resolve=>{release=()=>{audio.paused=false;resolve();};});
    const first=player.play();player.pause();release();await first;assert.ok(audio.paused);assert.equal(player.intent,false);
    const second=player.play();await player.loadSong({url:'file:///next.wav',duration_ms:1000});release();await second;
    assert.ok(audio.paused);assert.equal(player.intent,false);assert.equal(audio.src,'file:///next.wav');
  }finally{player.destroy();}
});
test('pause during an unfinished play never restarts the song',async()=>{
  const audio=new Media(),videos=[new Media(),new Media()],errors=[];
  const player=new CompositionPlayer(audio,videos,()=>{},message=>errors.push(message));
  try{
    await player.load(snapshot,[{id:'c',url:'file:///synthetic.mp4'}]);
    let release;
    videos[player.active].play=()=>new Promise(resolve=>{release=resolve;});
    const play=player.play();while(!release)await new Promise(resolve=>setTimeout(resolve,0));
    player.pause();release();await play;
    assert.equal(audio.paused,true);assert.equal(player.intent,false);assert.deepEqual(errors,[]);
    await player.seek(2500);assert.equal(player.current.id,'p1');assert.equal(videos[player.active].currentTime,.5);assert.ok(audio.paused);
  }finally{player.destroy();}
});

test('invalidating an active preview keeps the same audio clock playing and stops its video decoders',async()=>{
  const audio=new Media(),videos=[new Media(),new Media()],player=new CompositionPlayer(audio,videos,()=>{},assert.fail);
  try{
    await player.load(snapshot,[{id:'c',url:'file:///synthetic.mp4'}],1500);await player.play();
    let pauses=0;audio.addEventListener('pause',()=>pauses++);const src=audio.src;
    player.detachPreview();
    assert.equal(pauses,0);assert.equal(audio.paused,false);assert.equal(player.intent,true);
    assert.equal(audio.currentTime,1.5);assert.equal(audio.src,src);assert.equal(player.snapshot,null);
    assert.ok(videos.every(v=>v.paused&&v.hidden));
    await player.seek(2200);assert.equal(audio.paused,false);assert.equal(audio.currentTime,2.2);
    player.pause();player.detachPreview();assert.equal(audio.paused,true);assert.equal(player.intent,false);
  }finally{player.destroy();}
});

test('late preview play completions cannot stop song playback after an edit',async()=>{
  for(const pending of ['video','audio']){
    const audio=new Media(),videos=[new Media(),new Media()],player=new CompositionPlayer(audio,videos,()=>{},assert.fail);
    try{
      await player.load(snapshot,[{id:'c',url:'file:///synthetic.mp4'}]);
      let release,calls=0;const target=pending==='audio'?audio:videos[player.active];
      target.play=()=>++calls===1?new Promise(resolve=>{release=()=>{target.paused=false;resolve();};}):Media.prototype.play.call(target);
      const play=player.play();while(!release)await new Promise(resolve=>setTimeout(resolve,0));
      player.detachPreview();await Promise.resolve();assert.equal(audio.paused,false);
      release();await play;
      assert.equal(audio.paused,false,pending);assert.equal(player.intent,true);assert.equal(player.snapshot,null);
      assert.ok(videos.every(v=>v.paused&&v.hidden));
    }finally{player.destroy();}
  }
});

test('live preview updates preserve the audio source, clock and intent across cuts',async()=>{
  const audio=new Media(),videos=[new Media(),new Media()],player=new CompositionPlayer(audio,videos,()=>{},assert.fail);
  try{
    await player.load(snapshot,[{id:'c',url:'file:///synthetic.mp4'}],1200);await player.play();
    let pauses=0,loads=0;audio.addEventListener('pause',()=>pauses++);audio.load=()=>loads++;
    const next=structuredClone(snapshot);next.placements[0].source_in_ms=400;
    await player.updatePreview(next,[{id:'c',url:'file:///synthetic.mp4'}]);
    assert.equal(player.snapshot,next);assert.equal(player.current.id,'p0');
    assert.equal(videos[player.active].currentTime,1.6);assert.equal(videos[player.active].hidden,false);
    assert.equal(audio.currentTime,1.2);assert.equal(audio.src,snapshot.song.url);assert.equal(audio.paused,false);
    audio.currentTime=2.2;player.tick();while(player.aligning)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(player.current.id,'p1');assert.ok(Math.abs(videos[player.active].currentTime-.2)<.001);
    assert.equal(pauses,0);assert.equal(loads,0);assert.equal(player.intent,true);
    player.pause();await player.updatePreview(next,[{id:'c',url:'file:///synthetic.mp4'}]);
    assert.equal(player.intent,false);assert.equal(audio.paused,true);assert.ok(videos.every(v=>v.paused));
  }finally{player.destroy();}
});

test('a delayed live decoder follows the advancing song and cannot restart a stopped preview',async()=>{
  for(const stopped of [false,true]){
    const audio=new Media(),videos=[new Media(),new Media()],player=new CompositionPlayer(audio,videos,()=>{},assert.fail);
    try{
      await player.loadSong({...snapshot.song,duration_ms:4000});await player.play();
      for(const video of videos)video.readyState=0;
      const updating=player.updatePreview(snapshot,[{id:'c',url:'file:///synthetic.mp4'}]);
      audio.currentTime=1.5;if(stopped)player.pause();
      for(const video of videos){video.readyState=4;video.dispatchEvent(new Event('loadedmetadata'));}
      await updating;
      assert.equal(audio.currentTime,1.5);assert.equal(audio.paused,stopped);assert.equal(player.intent,!stopped);
      if(!stopped)assert.equal(videos[player.active].currentTime,1.6,'catch up to the latest audio clock after loading');
      else assert.ok(videos.every(v=>v.paused&&v.hidden));
    }finally{player.destroy();}
  }
});

test('live decoder failure keeps the song playing',async()=>{
  const audio=new Media(),videos=[new Media(),new Media()],errors=[],player=new CompositionPlayer(audio,videos,()=>{},m=>errors.push(m));
  try{
    await player.loadSong({...snapshot.song,duration_ms:4000});await player.play();
    for(const video of videos)video.readyState=0;
    const updating=player.updatePreview(snapshot,[{id:'c',url:'file:///synthetic.mp4'}]);
    for(const video of videos)video.dispatchEvent(new Event('error'));
    await updating;
    assert.equal(audio.paused,false);assert.equal(player.intent,true);assert.equal(player.snapshot,null);
    assert.match(errors[0],/cannot be decoded/);
  }finally{player.destroy();}
});

function fakeApp(){
  const local={video:new Media(),pause(){this.video.pause();}},calls=[];
  const engine=name=>({player:local,_active:false,start(){this._active=true;calls.push(`${name}:start`);},stop(){this._active=false;calls.push(`${name}:stop`);},reloadActions(){},clearAxisActions(){this.axes={};},setAxisActions(axis,actions){this.axes[axis]=actions;},setVibrationActions(){},axes:{}});
  const app={videoPlayer:local,_clearMiniplayer(){},_resetCustomRoutingState(){},
    funscriptEngine:{_fillerOptions:{enabled:true},setFillerOptions(value){this._fillerOptions=value;},async loadContent(value){this.content=value;},clear(){this.content=null;}},
    buttplugManager:{connected:true},handyManager:{connected:false,async hsspStop(){}},autoblowManager:{connected:false},tcodeManager:{connected:false},
    buttplugSync:engine('buttplug'),tcodeSync:engine('tcode'),syncEngine:engine('handy'),autoblowSync:engine('autoblow')};
  return {app,calls};
}
test('Composer reuses configured engines, supplies six-axis data and releases its clock',async()=>{
  const {app,calls}=fakeApp(),devices=new ComposerDeviceSession(app),wrapper={video:new Media(),paused:true,currentTime:0};
  assert.equal(await devices.arm(snapshot,wrapper),true);
  assert.equal(app.buttplugSync.player,wrapper);assert.deepEqual(app.buttplugSync.axes.R0,snapshot.scripts.R0.actions);
  assert.equal(app.funscriptEngine._fillerOptions,null,'already compiled gaps are not filled twice');
  devices.release();assert.equal(app.buttplugSync.player,app.videoPlayer);assert.equal(app.buttplugSync._active,false);assert.deepEqual(app.buttplugSync.axes,{});
  assert.deepEqual(app.funscriptEngine._fillerOptions,{enabled:true});assert.deepEqual(calls,['buttplug:start','buttplug:stop']);
});
test('a cancelled cloud upload cannot arm an engine; following uploads wait their turn',async()=>{
  const {app,calls}=fakeApp();app.handyManager.connected=true;
  let finish;const uploaded=[];
  app.handyManager.uploadAndSetScript=content=>{uploaded.push(content);return new Promise(resolve=>{finish=resolve;});};
  const device=new ComposerDeviceSession(app),wrapper={video:new Media(),paused:true,currentTime:0};
  const first=device.arm(snapshot,wrapper);while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
  device.release();const second=app.handyManager.uploadAndSetScript('new owner');
  assert.equal(uploaded.length,1);finish(true);assert.equal(await first,false);
  while(uploaded.length<2)await new Promise(resolve=>setTimeout(resolve,0));finish(true);await second;
  assert.deepEqual(uploaded,[JSON.stringify(snapshot.scripts.L0),'new owner']);assert.ok(!calls.includes('handy:start'));
});
