import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ComposerView } from '../../renderer/composer/composer-view.js';
import { createSession, History } from '../../packages/composer-core/index.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t){
  t.mock.timers.enable({apis:['setTimeout']});
  const dom=new JSDOM('<select data-field="playback-mode"><option value="preview">Preview</option><option value="song">Song</option></select><div class="fc-preview-empty"></div>');
  const updates=[],messages=[],requests=[],view=Object.assign(Object.create(ComposerView.prototype),{
    root:dom.window.document.body,visible:true,preparationGeneration:0,history:new History(),
    session:createSession({id:'song',url:'file:///song.wav',name:'Song',duration_ms:10000},2),
    regionEditor:{pauseSource(){},finishDrag(){}},sectionEditor:{finishDrag(){}},timeline:{finishDrag(){}},
    devices:{active:false,release(){this.active=false;}},tick(){},draw(){},message(message){messages.push(message);},
    renderEditor(){this.schedulePreviewRefresh();},
    player:{intent:true,detachPreview(){this.snapshot=null;},pause(){this.intent=false;},async updatePreview(snapshot){this.snapshot=snapshot;updates.push(snapshot);},async load(snapshot){this.snapshot=snapshot;updates.push(snapshot);}},
    async ipc(action,{session}){assert.equal(action,'prepare');requests.push(session.name);return {snapshot:{name:session.name,warnings:[]},clips:[],asset_bindings:{}};},
  });
  t.after(()=>{clearTimeout(view.previewRefreshTimer);dom.window.close();});
  const advance=async()=>{t.mock.timers.tick(251);await settle();};
  return {view,updates,messages,requests,advance};
}

test('edits preserve preview mode and debounce rebuilding without restarting playback',async t=>{
  const {view,updates,requests,advance}=fixture(t);
  view.edit(s=>{s.name='First';},{keepPlacements:true});
  view.edit(s=>{s.name='Latest';},{keepPlacements:true});
  assert.equal(view.songOnly(),false);assert.equal(view.player.intent,true);
  assert.deepEqual(requests,[]);await advance();
  assert.deepEqual(requests,['Latest']);assert.equal(updates[0].name,'Latest');assert.equal(view.songOnly(),false);
  assert.equal(view.player.intent,true);assert.equal(view.devices.active,false);
  view.player.pause();view.edit(s=>{s.name='Paused edit';},{keepPlacements:true});await advance();
  assert.equal(updates.at(-1).name,'Paused edit');assert.equal(view.player.intent,false);
  view.root.querySelector('select').value='song';view.edit(s=>{s.name='Song edit';},{keepPlacements:true});await advance();
  assert.equal(view.songOnly(),true);assert.deepEqual(requests,['Latest','Paused edit']);
});

test('a source drag compiles once after finishing and also refreshes cancelled drags',async t=>{
  const {view,requests,advance}=fixture(t);
  view.invalidate();view.regionEditor.drag={};await advance();assert.deepEqual(requests,[]);
  view.session={...view.session,name:'Trimmed'};view.regionEditor.drag=null;view.renderEditor();await advance();
  assert.deepEqual(requests,['Trimmed']);
  view.invalidate();view.regionEditor.drag={};await advance();
  view.regionEditor.drag=null;view.renderEditor();await advance();
  assert.deepEqual(requests,['Trimmed','Trimmed']);
});

test('an in-flight rebuild cannot apply an older edit; the latest edit follows it',async t=>{
  const {view,updates,advance}=fixture(t),gate=deferred(),original=view.ipc;
  view.ipc=async(...args)=>{const prepared=await original(...args);await gate.promise;return prepared;};
  view.edit(s=>{s.name='Old';},{keepPlacements:true});await advance();
  view.edit(s=>{s.name='New';},{keepPlacements:true});await advance();assert.deepEqual(updates,[]);
  gate.resolve();await settle();assert.deepEqual(updates,[]);await advance();
  assert.deepEqual(updates.map(s=>s.name),['New']);
});

test('mode changes, hiding and song replacement discard delayed preview results',async t=>{
  const {view,updates,advance}=fixture(t),original=view.ipc;
  for(const cancel of ['mode','hide','song']){
    const gate=deferred();view.visible=true;view.root.querySelector('select').value='preview';
    view.ipc=async(...args)=>{const prepared=await original(...args);await gate.promise;return prepared;};
    view.invalidate();await advance();
    if(cancel==='mode'){view.root.querySelector('select').value='song';view.invalidate({pause:true});}
    if(cancel==='hide')view.hide();
    if(cancel==='song'){view.invalidate({pause:true});view.session=createSession({...view.session.song,id:'new-song'},2);}
    gate.resolve();await settle();await advance();assert.deepEqual(updates,[],cancel);
  }
});

test('preview refresh errors keep the selected mode and song intent without retrying forever',async t=>{
  const {view,updates,messages,advance}=fixture(t);let calls=0;
  view.ipc=async()=>{calls++;throw new Error('Some regions are empty.');};
  view.invalidate();await advance();await advance();
  assert.equal(calls,1);assert.deepEqual(updates,[]);assert.equal(view.songOnly(),false);assert.equal(view.player.intent,true);
  assert.match(messages.at(-1),/Preview could not update: Some regions are empty/);
  assert.equal(view.preparing,false);assert.equal(view.previewRefreshPending,false);
});

test('decoder failure does not mark an unavailable preview ready',async t=>{
  const {view,advance}=fixture(t);
  view.player.updatePreview=async()=>{view.player.detachPreview();view.message('A clip cannot be decoded.');};
  view.invalidate();await advance();
  assert.equal(view.prepared,null);assert.equal(view.root.querySelector('.fc-preview-empty').hidden,false);
  assert.equal(view.player.intent,true);assert.equal(view.songOnly(),false);
});

test('selection preferences preserve pending preparation but cannot revive a superseded media edit',async t=>{
  const {view,updates,advance}=fixture(t),original=view.ipc;
  for(const supersede of [false,true]){
    const gate=deferred();view.ipc=async(...args)=>{const result=await original(...args);await gate.promise;return result;};
    view.invalidate();await advance();
    view.edit(s=>{s.tag_preferences={prefer:['glasses'],less:[]};},{keepPlacements:true,affectsPlayback:false});
    const count=updates.length;if(supersede)view.edit(s=>{s.name='Changed media';},{keepPlacements:true});
    gate.resolve();await settle();
    assert.equal(updates.length,count+Number(!supersede));
    assert.deepEqual(view.session.tag_preferences,{prefer:['glasses'],less:[]});
    if(supersede){await advance();assert.equal(updates.at(-1).name,'Changed media');}
  }
});
