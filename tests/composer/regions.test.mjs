import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession,arrange,compile,validateSession,sectionCategories,planRegions,splitRegion,mergeRegion,moveRegionEdge,slipSource,splitSongSection,mergeSongSections,resizeSongSection,suggestRegionCuts,audioChangeMarkers,snapToAudio,normalizeSectionNames } from '../../packages/composer-core/index.mjs';

const song={id:'song',name:'song.wav',duration_ms:6000};
const clips=['A','B','C'].map((name,i)=>({id:name,name,categories:[name],duration_ms:10000,quality:i===2?3:5,available:true,scripts:{L0:{actions:[{at:0,pos:0},{at:10000,pos:100}]}}}));
const planned=()=>{const s=createSession(song,1);return planRegions(s,s.sections[0].id,[2000,4000]);};

test('section category pools include any selected folder and retain legacy category support',()=>{
  const s=createSession(song,1);s.sections[0].categories=['A','B'];s.min_rating=4;s.repeat_policy='cycle';
  const ready=arrange(planRegions(s,s.sections[0].id,[1000,2000,3000,4000,5000]),clips);
  assert.deepEqual(new Set(ready.placements.map(p=>p.clip_id)),new Set(['A','B']));
  delete s.sections[0].categories;s.sections[0].category='B';assert.deepEqual(sectionCategories(s.sections[0]),['B']);
  assert.ok(arrange(s,clips).placements.every(p=>p.clip_id==='B'));
  s.sections[0].categories=['A','A'];assert.throws(()=>validateSession(s),/unique folder categories/);
});

test('empty song regions are editable but cannot compile; assembly preserves their exact bounds',()=>{
  const s=planned();assert.doesNotThrow(()=>validateSession(s));assert.throws(()=>compile(s,clips),/regions are empty/);
  const result=arrange(s,clips);assert.deepEqual(result.placements.map(p=>[p.start_ms,p.end_ms]),[[0,2000],[2000,4000],[4000,6000]]);
  assert.doesNotThrow(()=>compile(result,clips));
  assert.throws(()=>arrange(s,clips.map(c=>({...c,duration_ms:1000}))),/No clip is long enough/);
  for(const cuts of [[3000,2000],[20],[6100]])assert.throws(()=>planRegions(s,s.sections[0].id,cuts),/Cuts must/);
});

test('cutting a region preserves source continuity and merging clears an insufficient source',()=>{
  const s=arrange(createSession(song,1),clips);s.placements[0].source_in_ms=1000;
  const cut=splitRegion(s,s.sections[0].id,2000);
  assert.equal(cut.placements[1].source_in_ms,3000);assert.equal(cut.placements[0].clip_id,cut.placements[1].clip_id);
  const merged=mergeRegion(cut,cut.placements[0].id,clips);assert.equal(merged.placements.length,1);assert.equal(merged.placements[0].source_in_ms,1000);
  const short=mergeRegion(cut,cut.placements[0].id,clips.map(c=>({...c,duration_ms:4000})));
  assert.equal(short.placements[0].clip_id,null);assert.doesNotThrow(()=>validateSession(short));
});

test('rolling a song boundary keeps neighbors joined and clamps to available source duration',()=>{
  const s=arrange(planned(),clips);s.placements.forEach(p=>{p.source_in_ms=1000;});
  const moved=moveRegionEdge(s,s.placements[0].id,'end',3000,clips);
  assert.equal(moved.placements[0].end_ms,3000);assert.equal(moved.placements[1].start_ms,3000);
  assert.equal(moved.placements[1].source_in_ms,1000);assert.doesNotThrow(()=>compile(moved,clips));
  const limited=clips.map(c=>({...c,duration_ms:3500}));
  assert.equal(moveRegionEdge(s,s.placements[0].id,'end',3500,limited).placements[0].end_ms,2500);
  assert.throws(()=>moveRegionEdge(s,s.placements[0].id,'start',100,clips),/Section edges/);
  s.sections[0].locked=true;assert.throws(()=>moveRegionEdge(s,s.placements[0].id,'end',2500,clips),/Unlock/);
});

test('slipping a source preserves song timing, maps its motion, and survives variations when kept',()=>{
  const s=arrange(planned(),clips),p=s.placements[0],slipped=slipSource(s,p.id,5000,clips);
  assert.equal(slipped.placements[0].start_ms,p.start_ms);assert.equal(slipped.placements[0].end_ms,p.end_ms);
  assert.equal(slipped.placements[0].source_in_ms,5000);assert.equal(slipped.placements[0].locked,true);
  const output=compile({...slipped,blend_ms:0},clips);assert.equal(output.scripts.L0.actions[0].pos,50);
  slipped.seed++;assert.deepEqual(arrange(slipped,clips).placements[0],slipped.placements[0]);
  assert.equal(slipSource(s,p.id,99999,clips).placements[0].source_in_ms,8000);
  assert.throws(()=>planRegions(slipped,slipped.sections[0].id,[1000]),/Unlock/);
});

test('large section edits preserve clip regions, source trims and unaffected sections',()=>{
  const s=arrange(planned(),clips);s.placements.forEach(p=>{p.source_in_ms=1000;});s.sections[0].categories=['A','B','C'];
  const split=splitSongSection(s,3000);assert.equal(split.sections.length,2);assert.equal(split.placements.length,4);assert.deepEqual(split.sections[1].categories,['A','B','C']);
  assert.equal(split.placements.find(p=>p.start_ms===3000).source_in_ms,2000);assert.doesNotThrow(()=>compile(split,clips));
  const resized=resizeSongSection(split,split.sections[0].id,4500,clips);assert.equal(resized.sections[1].start_ms,4500);assert.doesNotThrow(()=>compile(resized,clips));
  const merged=mergeSongSections(resized,0);assert.equal(merged.sections.length,1);assert.equal(merged.placements.length,resized.placements.length);assert.doesNotThrow(()=>compile(merged,clips));
  const partial=createSession(song,2),first=planRegions(partial,partial.sections[0].id,[1500]);
  assert.doesNotThrow(()=>validateSession(mergeSongSections(first,0)),'merging planned and unplanned sections leaves explicit empty regions');
});

test('repeated section splits create independent sections with distinct chronological names',()=>{
  const initial=createSession(song,2);initial.sections[0].categories=['A','B'];
  const first=splitSongSection(initial,2000),second=splitSongSection(first,1000),third=splitSongSection(second,1500);
  assert.deepEqual(third.sections.map(s=>s.label),['Section 1','Section 2','Section 3','Section 4','Section 5']);
  assert.equal(new Set(third.sections.map(s=>s.id)).size,5);assert.equal(third.sections.at(-1).id,initial.sections.at(-1).id);
  third.sections[1].categories.push('C');assert.deepEqual(third.sections[0].categories,['A','B'],'folder choices are independent after splitting');
  assert.doesNotThrow(()=>validateSession(third));
  assert.deepEqual(mergeSongSections(third,1).sections.map(s=>s.label),['Section 1','Section 2','Section 3','Section 4']);
  const named=createSession(song,1);named.sections[0].label='Verse';
  assert.deepEqual(splitSongSection(splitSongSection(named,3000),1000).sections.map(s=>s.label),['Verse','Verse (3)','Verse (2)']);
  const old=createSession(song,3);old.sections.map((s,i)=>{s.label=i?'Section 1 B':'Opening';});
  assert.deepEqual(normalizeSectionNames(old).sections.map(s=>s.label),['Opening','Section 2','Section 3']);
  assert.equal(old.sections[1].label,'Section 1 B','repair does not mutate the loaded recipe');
  const custom=createSession(song,1);custom.sections[0].label='Section 9';custom.sections[0].auto_label=false;
  assert.deepEqual(splitSongSection(custom,3000).sections.map(s=>s.label),['Section 9','Section 9 (2)'],'explicit user names are retained even when they resemble default names');
});

test('section boundaries resize empty layouts, retain no-op bindings and enforce neighboring limits',()=>{
  const empty=createSession(song,3),id=empty.sections[0].id;
  const resized=resizeSongSection(empty,id,2500,clips);
  assert.deepEqual(resized.sections.map(s=>[s.start_ms,s.end_ms]),[[0,2500],[2500,4000],[4000,6000]]);
  assert.deepEqual(resized.placements,[]);assert.doesNotThrow(()=>validateSession(resized));
  const filled=arrange(empty,clips);filled.asset_bindings={fixture:'unchanged'};
  assert.deepEqual(resizeSongSection(filled,id,2000,clips),filled,'returning to the original boundary does not split clips or clear bindings');
  for(const at of [0,99,3901,4000,6000,2500.5,NaN])assert.throws(()=>resizeSongSection(empty,id,at,clips),/section boundary/);
  for(const index of [0,1]){const locked=structuredClone(empty);locked.sections[index].locked=true;assert.throws(()=>resizeSongSection(locked,id,2500,clips),/Unlock both/);}
  empty.sections[0].categories=['A'];empty.sections[1].categories=['B'];
  const placed=arrange(empty,clips),changed=resizeSongSection(placed,id,2500,clips);
  assert.equal(changed.placements.find(p=>p.start_ms===2000).clip_id,null,'incompatible transferred footage becomes an empty region');
  assert.equal(changed.placements.find(p=>p.start_ms===2500).source_in_ms,500,'remaining footage preserves source continuity');
  assert.deepEqual(changed.placements.filter(p=>p.start_ms>=4000),placed.placements.filter(p=>p.start_ms>=4000));
  assert.doesNotThrow(()=>validateSession(changed,clips));
});

test('audio cuts use beat groups and texture changes; silence does not invent verse labels',()=>{
  const analysis={duration_ms:20000,bpm:120,beats:Array.from({length:40},(_,i)=>({at:i*500})),features:{energy:Array.from({length:200},(_,i)=>i<100?.1:.9),brightness:Array.from({length:200},(_,i)=>i<100?.1:.7),bass:Array(200).fill(.2)}};
  const markers=audioChangeMarkers(analysis);assert.ok(markers.some(p=>Math.abs(p.at-10000)<500));
  const section={start_ms:0,end_ms:20000},cuts=suggestRegionCuts(analysis,section,4);
  assert.ok(cuts.includes(10000));assert.ok(cuts.every((at,i)=>at>0&&at<20000&&(!i||at>cuts[i-1])));
  assert.equal(snapToAudio(1025,analysis),1000);assert.equal(snapToAudio(1230,analysis),1230);
  assert.deepEqual(audioChangeMarkers({duration_ms:20000,features:{energy:Array(200).fill(0)}}),[]);
  assert.throws(()=>suggestRegionCuts({duration_ms:20000,bpm:0,beats:[]},section),/Mark cuts manually/);
});
