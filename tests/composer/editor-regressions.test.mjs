import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ComposerView } from '../../renderer/composer/composer-view.js';
import { RegionEditor } from '../../renderer/composer/region-editor.js';
import { createSession, History } from '../../packages/composer-core/index.mjs';

const song={id:'song',name:'Original',duration_ms:1000};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function savingView(){
  const entered=deferred(),release=deferred(),writes=[],revisions=new Map();
  const view=Object.assign(Object.create(ComposerView.prototype),{
    session:createSession(song,1),revisions:new Map(),dirty:true,
    timeline:{action:()=>false},regionEditor:{action:async()=>false},refresh:async()=>{},message:()=>{},
    ipc:async(action,{session})=>{
      assert.equal(action,'save');writes.push(structuredClone(session));
      if(writes.length===1){entered.resolve();await release.promise;}
      assert.equal(session.revision,revisions.get(session.id)||0,'queued saves use the last acknowledged revision');
      revisions.set(session.id,session.revision+1);
      return {...session,revision:session.revision+1,asset_bindings:{}};
    },
  });
  return {view,entered,release,writes};
}
test('a save reply preserves newer edits and the next save uses its revision',async()=>{
  const {view,entered,release,writes}=savingView();
  const first=view.action('save');await entered.promise;
  view.session={...structuredClone(view.session),name:'Edited while saving'};view.dirty=true;
  release.resolve();await first;
  assert.equal(view.session.name,'Edited while saving');assert.equal(view.dirty,true);assert.equal(view.session.revision,1);
  await view.action('save');assert.equal(writes[1].name,'Edited while saving');assert.equal(view.session.revision,2);assert.equal(view.dirty,false);
});
test('a save reply cannot replace another opened session or its unsaved state',async()=>{
  const {view,entered,release}=savingView(),originalId=view.session.id;
  const saving=view.action('save');await entered.promise;
  const other=createSession({...song,name:'Other'},1);view.session=other;view.dirty=false;
  release.resolve();await saving;
  assert.equal(view.session,other);assert.equal(view.session.revision,0);assert.equal(view.dirty,false);
  assert.equal(view.revisions.get(originalId),1);
});
test('consecutive save requests serialize snapshots without losing later edits',async()=>{
  const {view,entered,release,writes}=savingView();
  const first=view.action('save');await entered.promise;
  view.session={...structuredClone(view.session),name:'Second snapshot'};
  const second=view.save();
  view.session={...structuredClone(view.session),name:'Third unsaved edit'};view.dirty=true;
  release.resolve();await Promise.all([first,second]);
  assert.deepEqual(writes.map(s=>s.name),['Original','Second snapshot']);
  assert.equal(view.session.name,'Third unsaved edit');assert.equal(view.session.revision,2);assert.equal(view.dirty,true);
  await view.save();assert.equal(view.session.revision,3);assert.equal(view.dirty,false);
});
test('a failed save leaves edits dirty and does not poison the save queue',async()=>{
  const {view}=savingView();let calls=0;
  view.ipc=async(_action,{session})=>{if(!calls++)throw new Error('Disk full');return {...session,revision:1};};
  await assert.rejects(()=>view.save(),/Disk full/);assert.equal(view.dirty,true);
  await view.save();assert.equal(view.dirty,false);assert.equal(view.session.revision,1);
});

test('source drags cancel on Escape after focus loss, blur and lost capture without an undo entry',()=>{
  for(const eventName of ['Escape','blur','lostpointercapture','pointercancel']){
    const dom=new JSDOM('<main><div class="fc-source-rail"><button data-source-drag="p">Trim</button></div></main>');
    try{
      const document=dom.window.document,root=document.querySelector('main'),session=createSession(song,1);
      session.placements=[{id:'p',clip_id:'a',section_id:session.sections[0].id,start_ms:0,end_ms:1000,source_in_ms:0,rate:1}];
      root.setPointerCapture=()=>{};root.hasPointerCapture=()=>false;
      root.querySelector('.fc-source-rail').getBoundingClientRect=()=>({width:100});
      const view={root,session,dirty:false,sectionEditor:{},catalog:{clips:[{id:'a',duration_ms:2000}]},history:new History(),
        invalidate:()=>{},renderEditor:()=>{},renderInspector:()=>root.querySelector('button').remove(),message:m=>assert.fail(m)};
      const editor=new RegionEditor(view);editor.renderTrack=()=>{};
      const button=root.querySelector('button');button.focus();
      editor.beginDrag({target:button,button:0,pointerId:1,clientX:0,preventDefault(){}});
      editor.moveDrag({pointerId:1,clientX:20,preventDefault(){}});
      assert.equal(document.activeElement.tagName,'BODY');assert.equal(view.session.placements[0].source_in_ms,400);
      if(eventName==='Escape')document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      else if(eventName==='blur')dom.window.dispatchEvent(new dom.window.Event('blur'));
      else{const event=new dom.window.Event(eventName);Object.defineProperty(event,'pointerId',{value:1});root.dispatchEvent(event);}
      assert.equal(editor.drag,null,eventName);assert.equal(view.session,session);assert.equal(view.dirty,false);assert.equal(view.history.past.length,0);
    }finally{dom.window.close();}
  }
});
