import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {composerShortcut} from '../../renderer/composer/keyboard.js';

test('Space toggles Composer from timeline buttons, range controls and body, once per press',()=>{
  const dom=new JSDOM('<nav><button>Outside</button></nav><main><button>Clip</button><input type="range"><input type="text"><input type="checkbox"><select></select><div contenteditable="true">Edit</div><video data-source-preview></video><audio data-music-audition controls></audio></main>');
  try{
    const document=dom.window.document,root=document.querySelector('main'),actions=[];
    const view={root,visible:true,session:{},action:async action=>{actions.push(action);},message:assert.fail};
    document.addEventListener('keydown',e=>composerShortcut(e,view),true);
    const press=(target,extra={})=>{const e=new dom.window.KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true,...extra});target.dispatchEvent(e);return e.defaultPrevented;};
    for(const el of [document.body,root.querySelector('button'),root.querySelector('[type=range]')])assert.equal(press(el),true);
    assert.equal(actions.length,3);assert.equal(press(document.body,{repeat:true}),true);assert.equal(actions.length,3);
    for(const el of document.querySelectorAll('nav button,[type=text],[type=checkbox],select,[contenteditable],video,audio'))assert.equal(press(el),false);
    for(const extra of [{ctrlKey:true},{altKey:true},{metaKey:true}])assert.equal(press(document.body,extra),false);
    assert.equal(actions.length,3);
    const dialog=document.createElement('dialog');dialog.setAttribute('open','');root.append(dialog);
    assert.equal(press(root.querySelector('button')),false);dialog.remove();
    const panel=document.createElement('div');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.hidden=true;document.body.append(panel);
    assert.equal(press(document.body),true,'mounted but hidden app panels do not block Composer shortcuts');assert.equal(actions.length,4);
    panel.hidden=false;panel.getClientRects=()=>[{}];
    assert.equal(press(document.body),false,'visible custom modal retains keyboard focus');panel.remove();
    view.visible=false;assert.equal(press(document.body),false);assert.equal(actions.length,4);
  }finally{dom.window.close();}
});

test('F, M and fullscreen Escape act on Composer without stealing typing or modal keys',()=>{
  const dom=new JSDOM('<main><button>Play</button><input type="text"></main>');
  try{
    const document=dom.window.document,root=document.querySelector('main'),actions=[];
    const view={root,visible:true,session:{},previewControls:{fullscreen:true},action:async a=>{actions.push(a);},message:assert.fail};
    document.addEventListener('keydown',e=>composerShortcut(e,view),true);
    const press=(key,target=document.body,extra={})=>{const event=new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra});target.dispatchEvent(event);return event.defaultPrevented;};
    assert.equal(press('f'),true);assert.equal(press('M'),true);assert.equal(press('Escape'),true);
    assert.deepEqual(actions,['fullscreen','mute','fullscreen']);
    assert.equal(press('f',root.querySelector('input')),false);assert.equal(press('m',document.body,{ctrlKey:true}),false);
    assert.equal(press('f',document.body,{repeat:true}),true);assert.equal(actions.length,3);
    view.previewControls.fullscreen=false;assert.equal(press('Escape'),false);
    const dialog=document.createElement('dialog');dialog.open=true;root.append(dialog);
    assert.equal(press('f'),false);assert.equal(actions.length,3);
  }finally{dom.window.close();}
});
