import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRun,findPhrase,validateScript,presentation} from '../../packages/manga-core/motion.mjs';
const actions=Array.from({length:9},(_,i)=>({at:i*250,pos:i%2?80:20}));
const scripted={id:'one',media:'video',durationMs:2000,scripts:{L0:{actions}}};
test('no-script panels retain duration and are explicitly motion-gated',()=>{
 const run=compileRun([scripted,{id:'two',media:'second',durationMs:1000}]);assert.equal(run.duration_ms,3000);assert.equal(run.segments[1].motion,false);assert.equal(run.segments[0].nextPanel,2000);
});
test('loop repeats the exact motion timing with fixed next-panel offsets',()=>{
 const run=compileRun([scripted,{id:'two',media:'second',durationMs:1000,presentation:{mode:'none'}}],{mode:'loop',extraSeconds:3});assert.deepEqual(run.segments.map(s=>s.kind),['video','loop','loop','video']);assert.equal(run.segments[0].nextPanel,6000);assert.equal(run.scripts.L0.actions.find(a=>a.at===2250).pos,80);
});
test('extension finds complete repeating phrases and retains unequal beat spacing',()=>{
 const a=[0,120,400,520,800,920,1200,1320,1600].map((at,i)=>({at,pos:i%2?85:15}));const item={...scripted,durationMs:1600,scripts:{L0:{actions:a},R0:{actions:a.map(a=>({...a,pos:100-a.pos}))}}};
 const phrase=findPhrase(item.scripts,1600);assert.equal(phrase.duration,800);const run=compileRun([item],{mode:'extend',extraSeconds:1});assert.equal(run.duration_ms,3200);assert.equal(run.segments[1].kind,'extension');assert.equal(run.scripts.L0.actions.find(a=>a.at===1720).pos,85);assert.equal(run.scripts.R0.actions.find(a=>a.at===1720).pos,15);
});
test('flat and irregular scripts do not invent rhythm; bad ranges fail clearly',()=>{
 assert.throws(()=>findPhrase({L0:{actions:[{at:0,pos:30},{at:2000,pos:30}]}},2000),/No stable/);assert.throws(()=>findPhrase(scripted.scripts,2000,[0,250]),/similar motion/);
});
test('invalid script timestamps, settings, and bounds are rejected',()=>{
 assert.throws(()=>validateScript({actions:[{at:0,pos:10},{at:0,pos:20}]},100),/invalid/);assert.throws(()=>validateScript({actions:[{at:0,pos:10},{at:1000,pos:120}]},1000),/invalid/);assert.throws(()=>presentation({extraSeconds:Infinity}),/Invalid/);
});
test('extend mode never borrows motion for another unscripted panel',()=>{
 const run=compileRun([scripted,{id:'two',media:'second',durationMs:1000}],{mode:'extend',extraSeconds:1});assert.equal(run.segments.filter(s=>s.panelId==='two').length,1);assert.equal(run.segments.at(-1).motion,false);
});
test('an unscripted gap cannot overwrite the following bounded motion entry',()=>{
 const next={...scripted,id:'next',scripts:{L0:{actions:actions.map(a=>({...a,pos:100-a.pos}))}}};const run=compileRun([scripted,{id:'gap',media:'gap',durationMs:1000},next]);
 assert.equal(run.scripts.L0.actions.find(a=>a.at===3000).pos,20);assert.ok(run.scripts.L0.actions.some(a=>a.at>3000&&a.at<=3150));assert.equal(run.scripts.L0.actions.find(a=>a.at===3250).pos,20);
});
test('flat dwell points retain rhythm when finding a repeatable phrase',()=>{
 const actions=[{at:0,pos:20},{at:100,pos:20},{at:250,pos:80},{at:500,pos:20},{at:600,pos:20},{at:750,pos:80},{at:1000,pos:20}];assert.equal(findPhrase({L0:{actions}},1000).duration,1000);
});
test('inverted source scripts are normalized exactly once',()=>{
 const run=compileRun([{...scripted,scripts:{L0:{inverted:true,actions}}}]);assert.equal(run.scripts.L0.actions[0].pos,80);assert.equal(run.scripts.L0.inverted,false);
});
test('still reading time reserves exact offsets without looped or inherited motion',()=>{
 const run=compileRun([scripted,{id:'page:two',pageStill:true,static:'image',presentation:{stillSeconds:3}}, {...scripted,id:'next'}]);
 assert.equal(run.segments[1].duration,3000);assert.equal(run.segments[1].pageStill,true);assert.equal(run.segments[1].motion,false);assert.equal(run.segments[2].start,5000);
 assert.equal(compileRun([{id:'still'}]).duration_ms,10000);
 assert.equal(compileRun([{id:'still'}],{mode:'loop',stillSeconds:2}).segments.length,1);
 assert.equal(compileRun([{id:'still'}],{stillSeconds:0}).segments[0].motion,false);
 for(const stillSeconds of [-1,Infinity,601,'10'])assert.throws(()=>presentation({stillSeconds}),/Invalid stillSeconds/);
});
