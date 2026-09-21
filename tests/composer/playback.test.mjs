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
