import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { connectedDeviceNames, previewDeviceStatus, PreviewControls, PLAYER_MARKUP } from '../../renderer/composer/preview-controls.js';
import { ComposerView } from '../../renderer/composer/composer-view.js';

function withSeekBar(check){
  const dom=new JSDOM(`<main>${PLAYER_MARKUP}</main>`),previousObserver=globalThis.ResizeObserver;
  globalThis.ResizeObserver=class{observe(){}};
  try{
    const root=dom.window.document.querySelector('main'),seeks=[];
    const view={root,visible:true,session:{song:{duration_ms:6000}},app:{},devices:{active:false},player:{audio:{volume:.7},intent:false},songOnly:()=>true,
      setPosition(time){seeks.push(time);controls.tick(time);}};
    const controls=new PreviewControls(view),seek=controls.seek;seek.max=6000;
    // Match Composer's delegated change handler: the range must own its events.
    root.addEventListener('change',event=>{if(event.target===seek)view.setPosition(Number(seek.value));});
    const emit=(type,target=seek,extra={})=>{const event=new dom.window.Event(type,{bubbles:true});Object.assign(event,{pointerId:1,button:0,...extra});target.dispatchEvent(event);};
    check({controls,seek,seeks,view,window:dom.window,emit});
  }finally{dom.window.close();if(previousObserver===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=previousObserver;}
}

for(const playing of [false,true])test(`seek clicks and drags apply immediately while ${playing?'playing':'paused'} and resist timer updates`,()=>withSeekBar(({controls,seek,seeks,view,window,emit})=>{
  view.player.intent=playing;controls.tick(4500);emit('pointerdown');
  seek.value=1200;emit('input');assert.deepEqual(seeks,[1200],'seek on press, before release');
  controls.tick(4550);assert.equal(seek.value,'1200');assert.equal(controls.elapsed.textContent,'0:01.2');
  seek.value=4200;emit('input');controls.tick(4600);assert.equal(seek.value,'4200');
  emit('pointerup',window);emit('change');assert.deepEqual(seeks,[1200,4200],'release must not repeat the last seek');
  controls.tick(4300);assert.equal(seek.value,'4300','clock updates resume after release');assert.equal(view.player.intent,playing);
}));

test('keyboard input and change-only seeking commit once per selected position',()=>withSeekBar(({seek,seeks,emit})=>{
  seek.value=1200;emit('input');emit('change');assert.deepEqual(seeks,[1200]);
  seek.value=4200;emit('change');assert.deepEqual(seeks,[1200,4200]);
}));

test('cancelled or abandoned scrubs release the clock display',()=>withSeekBar(({controls,seek,window,emit})=>{
  for(const finish of [()=>emit('pointercancel',window),()=>emit('lostpointercapture'),()=>emit('blur',window),()=>controls.hide()]){
    emit('pointerdown');seek.value=900;emit('input');controls.tick(1000);assert.equal(seek.value,'900');
    finish();controls.tick(1200);assert.equal(seek.value,'1200');
  }
}));

test('device status distinguishes a connection, a pending upload and armed sync',()=>{
  const view={app:{buttplugManager:{connected:true,devices:[]}},devices:{active:false},player:{intent:false}};
  assert.deepEqual(connectedDeviceNames(view.app),[],'an Intiface server without a device is not a usable connection');
  assert.equal(previewDeviceStatus(view).state,'off');
  view.app.handyManager={connected:true};assert.equal(previewDeviceStatus(view).title,'Handy connected');
  view.devices.active=true;view.devicePreparing=true;
  assert.equal(previewDeviceStatus(view).state,'preparing','an upload in progress is not ready to play');
  view.devicePreparing=false;assert.equal(previewDeviceStatus(view).title,'Handy · Sync ready');
  view.player.intent=true;assert.equal(previewDeviceStatus(view).title,'Handy · Sync enabled');
  view.devices.active=false;assert.equal(previewDeviceStatus(view).state,'connected','editing requires preparing sync again');
  view.app.handyManager.connected=false;assert.equal(previewDeviceStatus(view).state,'off');
});

test('connection settings use the shared panel without exiting Composer fullscreen',async()=>{
  const calls=[],root={},document={fullscreenElement:root,async exitFullscreen(){calls.push('exit');this.fullscreenElement=null;}};
  const controls=Object.assign(Object.create(PreviewControls.prototype),{root,document,view:{app:{connectionPanel:{show(){calls.push('show');}}}}});
  await controls.openConnections();assert.deepEqual(calls,['show']);assert.equal(document.fullscreenElement,root);
});

test('a fullscreen request finishing after navigation exits again without touching playback',async()=>{
  const calls=[],document={fullscreenElement:null,async exitFullscreen(){calls.push('exit');this.fullscreenElement=null;}},view={visible:true};let enter;
  const root={requestFullscreen:()=>new Promise(resolve=>{enter=()=>{document.fullscreenElement=root;resolve();};})};
  const controls=Object.assign(Object.create(PreviewControls.prototype),{root,document,view});
  const pending=controls.toggleFullscreen();view.visible=false;enter();await pending;
  assert.deepEqual(calls,['exit']);assert.equal(document.fullscreenElement,null);
});

test('Stop during preview compilation cancels pending device setup before a script can be uploaded',async()=>{
  let finish,armCalls=0;
  const view=Object.assign(Object.create(ComposerView.prototype),{
    visible:true,session:{},timeline:{action:()=>false},regionEditor:{action:async()=>false,pauseSource(){}},tick(){},
    player:{pause(){},async seek(){}},devices:{generation:0,release(){this.generation++;},async arm(){armCalls++;}},
    prepare(){this.devices.release();return new Promise(resolve=>{finish=()=>{this.prepared={snapshot:{}};resolve();};});},
  });
  const pending=view.action('devices');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(view.devicePreparing,true);await view.action('stop');finish();await pending;
  assert.equal(armCalls,0);assert.equal(view.devicePreparing,false);
});

test('clip history is recorded only after successful device preparation, using its prepared receipt',async()=>{
  for(const outcome of [true,false,'failure']){
    const calls=[],view=Object.assign(Object.create(ComposerView.prototype),{
      visible:true,session:{},timeline:{action:()=>false},regionEditor:{action:async()=>false},tick(){},message(){},renderLibrary(){},
      prepared:{snapshot:{},usage_token:'prepared-receipt'},player:{pause(){}},
      devices:{generation:0,active:false,async arm(){if(outcome==='failure')throw new Error('Upload failed');return outcome;}},
      async ipc(action,payload){calls.push([action,payload]);return {clips:[]};}
    });
    if(outcome==='failure')await assert.rejects(view.action('devices'),/Upload failed/);else await view.action('devices');
    assert.deepEqual(calls,outcome===true?[['record-use',{token:'prepared-receipt'}]]:[]);
    assert.equal(view.devicePreparing,false);
  }
});
