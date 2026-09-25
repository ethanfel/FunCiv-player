import { arrange, clone, validateSession, videoIdentities, sectionRegions, clipRating, DEFAULT_AUTO_CLIPS } from './index.mjs';

const identityKey=clips=>{
  const identities=videoIdentities(clips);
  return id=>identities.get(id)||`clip:${id}`;
};
const exclude=(clips,blocked,key)=>clips.map(c=>blocked.has(key(c.id))?{...c,retired:true}:c);
const signature=(placements,key)=>JSON.stringify(placements.map(p=>[key(p.clip_id),p.start_ms,p.end_ms,p.source_in_ms,p.rate]));

// Arrange a section on a temporary clock starting at zero. Other sections can
// be empty or have unresolved clips; their contents and settings stay untouched.
function arrangeSection(session,section,placements,clips,seed){
  const start=section.start_ms,duration=section.end_ms-start;
  const scoped={...clone(session),seed,auto_clip:session.auto_clip??DEFAULT_AUTO_CLIPS,song:{...session.song,duration_ms:duration},
    sections:[{...clone(section),start_ms:0,end_ms:duration}],
    placements:clone(placements).map(p=>({...p,start_ms:p.start_ms-start,end_ms:p.end_ms-start}))};
  delete scoped.asset_bindings;
  // Placement selection does not use music curves. Their full-song ranges
  // must not be validated against this temporary section-length clock.
  delete scoped.music;
  return arrange(scoped,clips).placements.map(p=>({...p,start_ms:p.start_ms+start,end_ms:p.end_ms+start}));
}

/** Replace one source, keeping its song bounds and speed, even when explicitly kept. */
export function replaceClip(session,placementId,clips){
  validateSession(session);
  const old=session.placements.find(p=>p.id===placementId);
  if(!old)throw new Error('Select a clip region to replace.');
  const section=session.sections.find(s=>s.id===old.section_id);
  if(section.locked)throw new Error('Unlock this section before replacing a clip.');
  const key=identityKey(clips),blocked=new Set(old.clip_id?[key(old.clip_id)]:[]);
  if(session.repeat_policy!=='cycle')for(const p of session.placements)if(p.id!==old.id&&p.clip_id)blocked.add(key(p.clip_id));
  const seed=session.seed+1;
  let replacement;
  try{
    [replacement]=arrangeSection(session,{...section,start_ms:old.start_ms,end_ms:old.end_ms,planned_regions:true},
      [{...old,locked:false}],exclude(clips,blocked,key),seed);
  }catch(error){
    if(error.code==='ASSEMBLY_SEARCH_LIMIT')throw error;
    throw new Error('No different video fits this clip’s duration, folders, source filters, rating, draft and repeat settings. Add matching footage, adjust the filters or shorten the clip.');
  }
  const next=clone(session);next.seed=seed;
  next.placements=next.placements.map(p=>p.id===old.id?{...replacement,locked:true}:p);
  next.sections.find(s=>s.id===section.id).planned_regions=true;
  delete next.asset_bindings;validateSession(next);return next;
}

/** Rebuild only the selected section. Manual cuts and kept regions remain fixed. */
export function remakeSection(session,sectionId,clips){
  validateSession(session);
  const section=session.sections.find(s=>s.id===sectionId);
  if(!section)throw new Error('Select a section to remake.');
  if(section.locked)throw new Error('Unlock this section before remaking it.');
  const rows=sectionRegions(session,section),key=identityKey(clips);
  const changing=rows.filter(p=>!section.planned_regions||!p.locked);
  if(section.planned_regions&&!changing.length)throw new Error('Every clip in this section is kept. Unlock a clip before remaking the section.');
  const blocked=new Set(session.repeat_policy==='cycle'?[]:session.placements.filter(p=>p.section_id!==section.id&&p.clip_id).map(p=>key(p.clip_id)));
  const oldKeys=new Set(changing.filter(p=>p.clip_id).map(p=>key(p.clip_id))),before=signature(rows,key);
  let chosen,seed=session.seed+1;
  if(oldKeys.size){
    // A remake should try fresh footage before falling back to another draw
    // from its current pool. Retired flags exclude choices, not kept regions.
    try{chosen=arrangeSection(session,section,rows,exclude(clips,new Set([...blocked,...oldKeys]),key),seed);}
    catch(error){if(error.code==='ASSEMBLY_SEARCH_LIMIT')throw error;}
  }
  if(!chosen&&oldKeys.size){
    // If there is only enough spare footage for a partial refresh, retain the
    // stronger existing clips where possible and replace at least one source.
    const byId=new Map(clips.map(c=>[c.id,c]));
    const weakest=[...new Set([...changing].sort((a,b)=>clipRating(byId.get(a.clip_id))-clipRating(byId.get(b.clip_id))).filter(p=>p.clip_id).map(p=>key(p.clip_id)))];
    for(const old of weakest.slice(0,16)){
      try{
        const candidate=arrangeSection(session,section,rows,exclude(clips,new Set([...blocked,old]),key),seed);
        if(signature(candidate,key)!==before){chosen=candidate;break;}
      }catch(error){if(error.code==='ASSEMBLY_SEARCH_LIMIT')throw error;}
    }
  }
  if(!chosen){
    const pool=exclude(clips,blocked,key);
    // A small equal-rated pool can draw the same order. Try further seeds, but
    // never report a changed section when only the seed or placement IDs differ.
    for(let attempt=0;attempt<8;attempt++,seed++){
      const candidate=arrangeSection(session,section,rows,pool,seed);
      if(signature(candidate,key)!==before){chosen=candidate;break;}
    }
  }
  if(!chosen)throw new Error('No different arrangement found for this section. Add matching footage, adjust its filters or unlock kept clips; the timeline is unchanged.');
  const next=clone(session),others=next.placements.filter(p=>p.section_id!==section.id),ids=new Set(others.map(p=>p.id));
  for(const p of chosen){
    // Splitting a song section can leave generated IDs in the neighboring
    // section. Do not collide with them when rebuilding automatic cuts.
    const base=p.id;let suffix=0;while(ids.has(p.id))p.id=`${base}-remake-${++suffix}`;ids.add(p.id);
  }
  next.seed=seed;next.placements=[...others,...chosen].sort((a,b)=>a.start_ms-b.start_ms);
  delete next.asset_bindings;validateSession(next);return next;
}
