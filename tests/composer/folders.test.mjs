import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSession, arrange, matchesSection, planRegions, splitSongSection, mergeSongSections, validateSession } from '../../packages/composer-core/index.mjs';
import { draftAssemblyProposal } from '../../packages/composer-core/draft-proposal.mjs';
import { localFolder, matchesFolders } from '../../packages/composer-core/folders.mjs';
import { categoryGroups, folderTree } from '../../renderer/composer/folder-model.js';
import { folderReadiness } from '../../renderer/composer/clip-readiness.js';
import { ComposerService } from '../../electron/composer-service.cjs';

const clip = (id, directory, category = 'Pulse') => ({id, name:id, path:`${directory}/${id}.mp4`, duration_ms:1000, available:true, script_ready:true, categories:[category]});
const clips = [clip('sept','/library/September/Pulse'), clip('other','/library/Goblin/Pulse','Goblin/Pulse'), clip('lookalike','/library/September-old/Pulse')];
const song = {id:'song',name:'Song',duration_ms:1000};
const scope = {source:'local',path:'/library/September'};

test('folder scope limits categories and automatic/fixed assembly to the selected subtree', () => {
  const s = createSession(song,1); s.sections[0].folders = [scope];
  assert.deepEqual(clips.filter(c => matchesSection(c,s.sections[0])).map(c=>c.id),['sept']);
  assert.equal(arrange(s,clips).placements[0].clip_id,'sept');
  assert.equal(arrange(planRegions(s,s.sections[0].id,[]),clips).placements[0].clip_id,'sept');
  s.sections[0].categories = ['Other'];
  assert.throws(()=>arrange(s,clips),/No usable clips/);
  delete s.sections[0].folders; s.sections[0].categories = ['Goblin/Pulse'];
  assert.equal(arrange(s,clips).placements[0].clip_id,'other','legacy exact path category stays exact');
  assert.deepEqual(categoryGroups(clips).map(g=>[g.label,g.values]),[['Pulse',['Goblin/Pulse','Pulse']]]);
});

test('draft fallback cannot reach outside the chosen collection', () => {
  const s=createSession(song,1);s.sections[0].folders=[scope];
  const draft={...clips[1],origin:'dataset',review_status:'draft',local_video_id:'other',script_ready:false,remote_scripts:{L0:{}}};
  assert.equal(draftAssemblyProposal(s,[draft]),null);
  const inside={...draft,id:'inside',path:clips[0].path,local_video_id:'sept'};
  assert.equal(draftAssemblyProposal(s,[draft,inside]).assembled.placements[0].clip_id,'inside');
});

test('local and HF folders are separate scopes; linked variants use their physical directory', () => {
  const hf = {...clips[0],id:'hf',origin:'dataset',civitai_id:'1',local_video_id:'sept',category_paths:['Collection/Pulse']};
  assert.equal(matchesFolders(hf,[scope]),true);
  assert.equal(matchesFolders(hf,[{source:'hf',path:'Collection'}]),true);
  assert.equal(matchesFolders(clips[0],[{source:'hf',path:'Collection'}]),false);
  const cached = {...hf,local_video_id:undefined,video_source:'cache'};
  assert.equal(matchesFolders(cached,[scope]),false,'download cache is not a local collection');
  const windows = {path:'D:\\Clips\\September\\a.mp4'};
  assert.equal(localFolder(windows),'D:/Clips/September');
  assert.equal(matchesFolders(windows,[{source:'local',path:'D:/Clips'}]),true);
});

test('nested indexed roots form a single tree and physical collection names survive category flattening', () => {
  const catalog = {roots:['/library','/library/September'],clips};
  const tree = folderTree(catalog);
  assert.equal(tree.length,1); assert.equal(tree[0].path,'/library');
  assert.deepEqual(tree[0].children.map(n=>n.label),['Goblin','September','September-old']);
  assert.equal(tree[0].children[1].children[0].label,'Pulse');
  assert.equal(folderTree({roots:[],clips},[{source:'local',path:'/offline/Archive'}]).some(n=>n.path==='/offline/Archive'),true);
});

test('readiness counts source videos once while retaining distinct script variants and filtering them independently', () => {
  const local = {...clips[0],civitai_id:'1'}, draft = {...local,id:'hf',origin:'dataset',review_status:'draft'},
    approved = {...local,id:'approved',origin:'dataset',review_status:'approved'};
  const session = {include_drafts:false,min_rating:0},section = {motion:'clip'};
  let result = folderReadiness([local,draft,approved],session,section);
  assert.equal(result.total,1);assert.equal(result.variants,3);assert.equal(result.ready,1);assert.deepEqual(result.reasons,[]);
  result = folderReadiness([{...local,script_ready:false},{...draft,script_ready:false,remote_scripts:{L0:{}}}],{...session,include_drafts:true},section);
  assert.equal(result.total,1);assert.equal(result.ready,0);assert.deepEqual(result.reasons,['1 needs HF scripts']);
  result = folderReadiness([{...local,script_ready:false},{...draft,script_ready:false,remote_scripts:{L0:{}}}],session,section);
  assert.deepEqual(result.reasons,['1 needs HF scripts','1 draft excluded'],'an available HF draft explains the remedy instead of claiming no script exists');
  assert.equal(folderReadiness([local,{...local,id:'copy',path:'/copy.mp4'}],session,section).total,1);
});

test('folder scope persists across save/load, split and merge; malformed scopes are rejected', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-folder-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const service=await new ComposerService(root).init(),s=createSession({...song,duration_ms:2000},1);
  s.sections[0].folders=[scope];
  const saved=await service.saveSession(s),loaded=await service.loadSession(saved.id);
  assert.deepEqual(loaded.sections[0].folders,[scope]);
  const split=splitSongSection(loaded,1000);assert.deepEqual(split.sections[1].folders,[scope]);
  split.sections[1].folders[0].path='/library/Goblin';assert.deepEqual(split.sections[0].folders,[scope]);
  assert.deepEqual(mergeSongSections(split,0).sections[0].folders,[scope,{source:'local',path:'/library/Goblin'}]);
  split.sections[1].folders=[];assert.deepEqual(mergeSongSections(split,0).sections[0].folders,[]);
  for(const folders of [null,{},[scope,scope],[{source:'unknown',path:'/x'}],[{source:'local',path:''}]]){
    assert.throws(()=>validateSession({...s,sections:[{...s.sections[0],folders}]}),/section folders/);
  }
});
