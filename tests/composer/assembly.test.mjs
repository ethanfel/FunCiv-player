import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, arrange, planRegions, videoIdentities, validateSession } from '../../packages/composer-core/index.mjs';
import { draftAssemblyProposal } from '../../packages/composer-core/draft-proposal.mjs';

const song={id:'song',name:'Fixture',duration_ms:6000};
const clip=id=>({id,name:id,civitai_id:id,path:`/video/${id}.mp4`,available:true,duration_ms:2000,script_ready:true,categories:['A'],quality:5,review_status:'approved'});
const clips=['1','2','3','4','5','6'].map(clip);

test('assembly defaults to unique source videos across sections, variants and local copies',()=>{
  const s=createSession(song,3);assert.equal(s.repeat_policy,'never');
  const catalog=[...clips,{...clips[0],id:'hf-variant',path:'/cache/1.mp4'},{...clips[0],id:'local-copy',civitai_id:null}];
  const identities=videoIdentities(catalog);
  assert.equal(identities.get('1'),identities.get('hf-variant'));assert.equal(identities.get('1'),identities.get('local-copy'));
  const result=arrange(s,catalog);assert.equal(new Set(result.placements.map(p=>identities.get(p.clip_id))).size,3);
  assert.deepEqual(result,arrange(s,catalog),'seeded output is reproducible');
  const before=structuredClone(s);
  assert.throws(()=>arrange(s,catalog.filter(c=>['1','hf-variant','local-copy'].includes(c.id))),/without repeating a video/);
  assert.deepEqual(s,before,'failed assembly cannot replace the existing recipe');
  delete s.repeat_policy;assert.throws(()=>arrange(s,clips.slice(0,1)),/without repeating/,'old recipes also stop silent repeats');
  assert.throws(()=>validateSession({...s,repeat_policy:'anything'}),/repeat policy/);
});

test('reserved clips and restricted future category pools retain unique footage',()=>{
  const s=createSession(song,3);s.sections[2].categories=['Only 1'];
  const catalog=clips.slice(0,3).map(c=>({...c,categories:c.id==='1'?['A','Only 1']:['A']}));
  const result=arrange(s,catalog);assert.equal(result.placements.at(-1).clip_id,'1');
  result.sections[2].locked=true;result.seed++;
  const changed=arrange(result,catalog);
  assert.deepEqual(changed.placements.at(-1),result.placements.at(-1));
  assert.equal(new Set(changed.placements.map(p=>p.clip_id)).size,3);
});

test('planned regions avoid repeats and optional reuse exhausts matching videos first',()=>{
  const initial=createSession(song,1),s=planRegions(initial,initial.sections[0].id,[1000,2000,3000,4000,5000]);
  const result=arrange(s,clips);assert.equal(new Set(result.placements.map(p=>p.clip_id)).size,6);
  result.placements[5].locked=true;const kept=result.placements[5];result.seed++;
  const changed=arrange(result,clips);assert.deepEqual(changed.placements[5],kept);assert.equal(new Set(changed.placements.map(p=>p.clip_id)).size,6);
  s.repeat_policy='cycle';const repeated=arrange(s,clips.slice(0,3)).placements.map(p=>p.clip_id);
  assert.equal(new Set(repeated.slice(0,3)).size,3);assert.equal(new Set(repeated.slice(3,6)).size,3);
  for(let i=1;i<repeated.length;i++)assert.notEqual(repeated[i],repeated[i-1]);
});

test('draft suggestion proves sufficient unique footage without relaxing categories or ratings',()=>{
  const s=createSession(song,3);s.min_rating=4;s.sections.forEach(section=>{section.categories=['A'];});
  const approved=clips[0],drafts=clips.slice(1,3).map(c=>({...c,origin:'dataset',review_status:'draft'})),catalog=[approved,...drafts];
  assert.throws(()=>arrange(s,catalog),/without repeating/);
  const proposal=draftAssemblyProposal(s,catalog);
  assert.equal(proposal.draftCount,2);assert.deepEqual(proposal.fetchIds,[]);assert.equal(proposal.assembled.include_drafts,true);
  assert.equal(new Set(proposal.assembled.placements.map(p=>p.clip_id)).size,3);assert.equal(s.include_drafts,false);assert.deepEqual(s.placements,[]);
  for(const change of [{quality:3},{categories:['Other']},{available:false},{duration_ms:500}]){
    assert.equal(draftAssemblyProposal(s,[approved,drafts[0],{...drafts[1],...change}]),null,'unusable drafts cannot be offered as a solution');
  }
  assert.equal(draftAssemblyProposal(s,[approved,{...drafts[0],civitai_id:approved.civitai_id},drafts[1]]),null,'another script for the same video adds no footage');
  const pending=drafts.map(c=>({...c,script_ready:false,remote_scripts:{L0:{}}}));
  assert.deepEqual(new Set(draftAssemblyProposal(s,[approved,...pending]).fetchIds),new Set(['2','3']));
  assert.equal(draftAssemblyProposal({...s,include_drafts:true},catalog),null);
});
