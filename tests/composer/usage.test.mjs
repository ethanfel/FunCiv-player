import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsage,recordUsage,usageByClip} from '../../packages/composer-core/usage.mjs';
import {createSession,arrange,planRegions} from '../../packages/composer-core/index.mjs';

const clip=(id,quality=5)=>({id,civitai_id:id,path:`/${id}.mp4`,name:id,quality,script_ready:true,available:true,duration_ms:12000,categories:[]});
const catalog=[clip('a'),clip('b',4),clip('c',3),clip('d',4),clip('e',5)];
const weighted=(clips,usage)=>{const weights=usageByClip(clips,usage);return clips.map(c=>({...c,usage:weights.get(c.id)}));};

test('completed compositions lower use weight and five others restore it, with idempotent events',()=>{
  const empty=createUsage(),used=recordUsage(empty,'first',catalog,['a','a']);
  assert.equal(empty.sequence,0);assert.equal(used.sequence,1);
  assert.deepEqual(usageByClip(catalog,used).get('a'),{count:1,last:1,weight:20,recovery_remaining:5});
  assert.equal(recordUsage(used,'first',catalog,['a']),used);
  let history=used;
  for(let i=1;i<=5;i++){
    history=recordUsage(history,`other-${i}`,catalog,['b']);
    assert.equal(usageByClip(catalog,history).get('a').weight,20+16*i);
  }
  assert.equal(usageByClip(catalog,history).get('a').recovery_remaining,0);
  history=recordUsage(history,'reuse',catalog,['a']);assert.equal(usageByClip(catalog,history).get('a').weight,20);
  assert.equal(usageByClip(catalog,history).get('a').count,2);
});

test('history follows HF variants and subsequently linked local videos',()=>{
  const history=recordUsage(createUsage(),'used',[clip('a')],['a']);
  const clips=[...catalog,{...clip('a'),id:'new-variant',path:'/cache/a.mp4'},{...clip('a'),id:'local',civitai_id:null}];
  const stats=usageByClip(clips,history);
  for(const id of ['a','new-variant','local'])assert.equal(stats.get(id).weight,20);
  const next=recordUsage(history,'second',clips,['new-variant','local']);
  for(const id of ['a','new-variant','local'])assert.equal(usageByClip(clips,next).get(id).count,2);
});

test('automatic, fixed and cycle assemblies apply recent-use scores without relaxing minimum ratings',()=>{
  const history=recordUsage(createUsage(),'previous',catalog,['a','e']);
  const clips=weighted(catalog,history);
  for(const mode of ['automatic','fixed','cycle']){
    let s=createSession({id:'song',name:'Song',duration_ms:8000},1);
    s.auto_clip={min_ms:4000,max_ms:12000};s.min_rating=4;
    if(mode!=='automatic')s=planRegions(s,s.sections[0].id,[4000]);
    if(mode==='cycle')s.repeat_policy='cycle';
    const result=arrange(s,clips);assert.deepEqual(new Set(result.placements.map(p=>p.clip_id)),new Set(['b','d']));
    assert.deepEqual(result,arrange(s,clips),'unchanged history and seed reproduce the same selection');
    result.placements[0].locked=true;result.sections[0].planned_regions=true;
    assert.equal(arrange(result,weighted(catalog,recordUsage(history,'next',catalog,['b','d']))).placements[0].clip_id,result.placements[0].clip_id);
  }
  const s=createSession({id:'song',name:'Song',duration_ms:2000},1);s.min_rating=5;
  assert.ok(['a','e'].includes(arrange(s,clips).placements[0].clip_id),'recently used clips remain eligible when needed');
});
