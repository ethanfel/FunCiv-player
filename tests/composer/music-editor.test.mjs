import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicEditor } from '../../renderer/composer/music-editor.js';
import { ComposerView } from '../../renderer/composer/composer-view.js';

test('a late drums import cannot attach to a different song or a closed editor',async()=>{
  for(const replace of [editor=>{editor.view.session={id:'new-song'};},editor=>{editor.generation++;},editor=>{editor.view.visible=false;}]){
    let finish,applied=0;
    const editor=Object.assign(Object.create(MusicEditor.prototype),{generation:0,view:{session:{id:'original'},visible:true,job:()=>new Promise(resolve=>{finish=resolve;})},useTrack:async()=>{applied++;}});
    const pending=editor.action('import');replace(editor);finish({id:'beat',duration_ms:4000});await pending;assert.equal(applied,0);
  }
});

test('cancelling a beat-file chooser releases busy state and re-enables the music editor',async()=>{
  const states=[],progress={hidden:true},cancel={hidden:true};
  const view=Object.assign(Object.create(ComposerView.prototype),{busy:false,root:{querySelector:selector=>selector==='progress'?progress:cancel},
    ipc:async()=>null,musicEditor:{render(){states.push(view.busy);}},schedulePreviewRefresh(){}});
  assert.equal(await view.job('beat-audio'),null);assert.equal(view.busy,false);assert.deepEqual(states,[false]);
  assert.equal(progress.hidden,true);assert.equal(cancel.hidden,true);
});

import {createMusic} from '../../packages/composer-core/music.mjs';
import {createSession,validateSession} from '../../packages/composer-core/index.mjs';
function beatEditor(){
  const view={session:createSession({id:'song',name:'Song',duration_ms:1000},1),visible:true,busy:false,analysisGeneration:0,
    root:{querySelector:()=>({})},schedulePreviewRefresh(){},edit(fn){const next=structuredClone(this.session);fn(next);validateSession(next);this.session=next;}};
  view.session.music={...createMusic(),beat_track:{id:'old',name:'Old',duration_ms:1000},offset_ms:50,
    analysis:{duration_ms:1000,waveform:[1],onsets:[],beats:[]}};
  const editor=Object.assign(Object.create(MusicEditor.prototype),{view,generation:0,settings:{},render(){},discard(){},message(text){this.status=text;}});
  return editor;
}
test('failed source selection keeps the prior source, analysis, offset and saved script',async t=>{
  const editor=beatEditor(),before=structuredClone(editor.view.session);
  t.mock.method(globalThis,'fetch',async()=>({ok:false}));
  await assert.rejects(editor.useTrack({id:'new',name:'Missing',url:'file:///missing.wav',duration_ms:1000}),/Previous timing/);
  assert.deepEqual(editor.view.session,before);assert.equal(editor.view.busy,false);assert.equal(editor.pendingTrack,null);
});
test('selecting the analyzed source again is a no-op',async()=>{
  const editor=beatEditor(),before=editor.view.session;let calls=0;editor.analyzeBeat=async()=>calls++;
  await editor.useTrack({...before.music.beat_track});assert.equal(calls,0);assert.equal(editor.view.session,before);
});
test('source analysis commits atomically and cancelled work cannot replace the source',async t=>{
  t.mock.method(globalThis,'fetch',async()=>({ok:true,blob:async()=>({arrayBuffer:async()=>new ArrayBuffer(0)})}));
  const previous=globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext=class {async decodeAudioData(){return {length:11025,sampleRate:11025,numberOfChannels:1,getChannelData:()=>new Float32Array(11025)};}};
  t.after(()=>{if(previous===undefined)delete globalThis.OfflineAudioContext;else globalThis.OfflineAudioContext=previous;});
  const editor=beatEditor(),track={id:'new',name:'New',duration_ms:1000,url:'file:///new.wav'};
  await editor.useTrack(track);assert.equal(editor.view.session.music.beat_track.id,'new');assert.equal(editor.view.session.music.analysis.duration_ms,1000);assert.equal(editor.view.session.music.offset_ms,0);
  const before=structuredClone(editor.view.session),pending=editor.useTrack({...track,id:'cancelled'});editor.generation++;await pending;
  assert.deepEqual(editor.view.session,before);assert.equal(editor.view.busy,false);
});
