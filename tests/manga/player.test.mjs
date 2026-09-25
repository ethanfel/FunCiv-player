import test from 'node:test';
import assert from 'node:assert/strict';
import {MangaPlayer} from '../../renderer/manga/player.js';
import {compileRun} from '../../packages/manga-core/motion.mjs';
class Video extends EventTarget {
 constructor(){super();this.readyState=4;this.duration=2;this.currentTime=0;this.attrs={};this.paused=true;}
 getAttribute(k){return this.attrs[k]||null;}set src(v){this.attrs.src=v;this.currentTime=0;}get src(){return this.attrs.src;}
 removeAttribute(k){delete this.attrs[k];}load(){}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
 async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}
}
const actions=[{at:0,pos:20},{at:500,pos:80},{at:1000,pos:20},{at:1500,pos:80},{at:2000,pos:20}];
test('clock pauses at buffering/seek start and gates unscripted panels',async()=>{
 const videos=[new Video(),new Video()],player=new MangaPlayer(videos),events=[];
 for(const name of ['pause','playing','seeked','ended'])player.clock.addEventListener(name,()=>events.push(name));
 try{const run=compileRun([{id:'one',media:'one',durationMs:2000,scripts:{L0:{actions}}},{id:'two',media:'two',durationMs:2000}]);
  await player.load(run,'one');await player.play();assert.equal(player.wrapper.paused,false);player.video.currentTime=.8;player.tick();assert.equal(player.wrapper.currentTime,.8);
  player.video.dispatchEvent(new Event('waiting'));assert.equal(player.wrapper.paused,true);assert.equal(events.at(-1),'pause');
  player.video.dispatchEvent(new Event('playing'));assert.equal(player.wrapper.paused,false);
  player.video.dispatchEvent(new Event('seeking'));assert.equal(player.wrapper.paused,true);
  await player.select(1,0,true);assert.equal(player.intent,true);assert.equal(player.wrapper.paused,true);assert.equal(player.position,2000);
  const eventCount=events.length;videos[1-player.active].dispatchEvent(new Event('ended'));assert.equal(events.length,eventCount);
 }finally{player.destroy();}
});
test('motion extension advances independently of the held video and exits once',async()=>{
 const player=new MangaPlayer([new Video(),new Video()]);
 try{const run=compileRun([{id:'one',media:'one',durationMs:2000,scripts:{L0:{actions}}},{id:'two',media:'two',durationMs:2000,presentation:{mode:'none'}}],{mode:'extend',extraSeconds:3});
  await player.load(run,'one');await player.select(1,0,true);const held=player.video.currentTime;player.anchor-=300;player.tick();assert.ok(player.position>2250);assert.equal(player.video.currentTime,held);assert.equal(player.video.paused,true);
  await player.next();assert.equal(player.exitAtBoundary,true);await player.finish();assert.equal(player.segment.panelId,'two');assert.equal(player.wrapper.paused,true);
 }finally{player.destroy();}
});
test('still panels never replay the previous decoder audio',async()=>{
 const player=new MangaPlayer([new Video(),new Video()]);try{await player.load(compileRun([{id:'a',media:'one',durationMs:2000},{id:'b'}]),'a');await player.play();await player.select(1,0,false);await player.play();assert.equal(player.videos.some(v=>!v.paused),false);}finally{player.destroy();}
});
test('a pending browser play cancelled by navigation is not an unhandled error',async()=>{
 const player=new MangaPlayer([new Video(),new Video()]);try{await player.load(compileRun([{id:'a',media:'one',durationMs:2000}]),'a');let reject;player.video.play=()=>new Promise((_,r)=>{reject=r;});const playing=player.play();player.pause();reject(new Error('The play() request was interrupted by pause().'));await playing;assert.equal(player.intent,false);}finally{player.destroy();}
});
test('still countdown pauses, seeks, ignores decoder events, then resumes the next motion segment',async()=>{
 const player=new MangaPlayer([new Video(),new Video()]),events=[];clearInterval(player.timer);
 player.clock.addEventListener('playing',()=>events.push('playing'));
 try{
  const scripted={id:'a',media:'one',durationMs:2000,scripts:{L0:{actions}}};
  await player.load(compileRun([scripted,{id:'still'}, {...scripted,id:'b',media:'two'}],{stillSeconds:2}), 'a');
  await player.play();await player.select(1,0,true);assert.equal(player.wrapper.paused,true);assert.equal(player.videos.some(v=>!v.paused),false);
  player.anchor-=350;player.tick();assert.ok(player.position>=2350);assert.equal(events.length,1);
  const anchor=player.anchor;
  for(const name of ['waiting','seeking','playing','ended','error'])player.video.dispatchEvent(new Event(name));
  await player.setBubbles(false);assert.equal(player.anchor,anchor);assert.equal(player.running,true);assert.equal(player.segment.kind,'still');
  player.pause();const frozen=player.position;player.anchor-=1000;player.tick();assert.equal(player.position,frozen);
  await player.seekPanel(750);assert.equal(player.position,2750);assert.equal(player.intent,false);
  await player.play();player.anchor-=1300;player.tick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(player.segment.panelId,'b');assert.equal(player.position,4000);assert.equal(player.wrapper.paused,false);assert.equal(events.length,2);
 }finally{player.destroy();}
});
test('manual still reading holds until Next, while a completed timer ends its page once',async()=>{
 const ends=[],player=new MangaPlayer([new Video(),new Video()],{onEnd:o=>ends.push(o)});clearInterval(player.timer);
 try{
  await player.load(compileRun([{id:'page',pageStill:true}],{stillSeconds:0,autoplay:'continuous'}),'page');await player.play();assert.equal(player.intent,false);assert.equal(player.holding,true);
  player.tick();assert.equal(ends.length,0);await player.next();assert.deepEqual(ends,[{advancePage:true}]);
  await player.load(compileRun([{id:'page',pageStill:true}],{stillSeconds:1,autoplay:'continuous',mode:'extend'}),'page');await player.play();player.anchor-=1100;player.tick();player.tick();assert.equal(ends.length,2);assert.equal(player.intent,false);
  await player.load(compileRun([{id:'page'}],{stillSeconds:1,autoplay:'manual'}),'page');await player.play();player.anchor-=1100;player.tick();assert.equal(ends.length,2);assert.equal(player.holding,true);
 }finally{player.destroy();}
});
test('preloading skips repeats and stills, decodes the next page, and never starts its audio',async()=>{
 const videos=[new Video(),new Video()],player=new MangaPlayer(videos);clearInterval(player.timer);
 try{
  const run=compileRun([{id:'one',media:'one',durationMs:2000},{id:'still'},{id:'two',media:'two',durationMs:2000}],{mode:'loop',extraSeconds:1});
  await player.load(run,'one');await player.warmTask.promise;
  assert.equal(videos[1-player.active].src,'two');assert.equal(videos[1-player.active].paused,true);assert.equal(videos[1-player.active].muted,true);
  const warm=videos[1-player.active];let loads=0;warm.load=()=>loads++;
  await player.select(run.segments.findIndex(s=>s.panelId==='two'),0,true);assert.equal(player.video,warm);assert.equal(loads,0,'prepared decoder is promoted without reloading');
  player.setAheadRun(compileRun([{id:'next-page',media:'three',durationMs:2000}]));await player.warmTask.promise;
  assert.equal(videos[1-player.active].src,'three');assert.equal(videos[1-player.active].paused,true);
  player.clearAhead();assert.equal(player.aheadRun,null);
 }finally{player.destroy();}
});
test('the outgoing picture is retained until a delayed incoming video is ready',async()=>{
 const events=[],player=new MangaPlayer([new Video(),new Video()],{onTransition:s=>events.push(s)});clearInterval(player.timer);
 try{
  await player.load(compileRun([{id:'a',media:'one',durationMs:2000},{id:'b',media:'two',durationMs:2000}]),'a');
  const old=player.video;let release;player.ready=()=>new Promise(resolve=>release=()=>resolve(true));
  const selecting=player.select(1,0,true);assert.equal(events.at(-1),'begin');assert.equal(old.hidden,false);
  release();await selecting;assert.equal(events.at(-1),'ready');assert.equal(old.hidden,true);
 }finally{player.destroy();}
});

test('timed overlays, including an intentionally empty list, always use the clean decoder',()=>{
 const player=Object.assign(Object.create(MangaPlayer.prototype),{bubbles:true});
 const s={media:'clean',baked:'bubbles-on',overlay:null};
 assert.equal(player.source(s),'bubbles-on');
 assert.equal(player.source({...s,bubbleLayers:[]}),'clean');
 assert.equal(player.source({...s,bubbleLayers:[{image:'timed'}]}),'clean');
 player.bubbles=false;assert.equal(player.source(s),'clean');
});
