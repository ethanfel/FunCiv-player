import { arrange, isDraftClip, hasMotionForSection, videoIdentities, validateSession, validateCoverage, assertClipRatings, assertClipReviews, matchesSection, clone } from './index.mjs';

const asset=clip=>JSON.stringify([clip.path,clip.size,clip.mtime,clip.duration_ms,clip.civitai_id,clip.variant_id,clip.remote_scripts,clip.audio_sync]);

/** Read-only trial: keep categories, stars, locks and repeat rules unchanged. */
export function draftAssemblyProposal(session,clips){
  if(session.include_drafts)return null;
  const next={...session,include_drafts:true};
  const candidate=clips.map(c=>c.available&&c.origin==='dataset'&&c.remote_scripts?.L0?{...c,script_ready:true}:c);
  let assembled;
  try{assembled=arrange(next,candidate);}catch{return null;}
  const used=new Set(assembled.placements.map(p=>p.clip_id)),identities=videoIdentities(clips);
  const drafts=clips.filter(c=>used.has(c.id)&&isDraftClip(c));
  if(!drafts.length)return null;
  const fetchIds=clips.filter(c=>used.has(c.id)&&assembled.placements.some(p=>p.clip_id===c.id&&!hasMotionForSection(c,assembled.sections.find(s=>s.id===p.section_id)))).map(c=>c.id);
  return {session:next,assembled,draftCount:new Set(drafts.map(c=>identities.get(c.id))).size,fetchIds,
    assets:Object.fromEntries(clips.filter(c=>used.has(c.id)).map(c=>[c.id,asset(c)]))};
}

/** Commit the arrangement the user accepted; downloading is not a new draw. */
export function acceptDraftAssembly(proposal,clips){
  const session=proposal.assembled,byId=new Map(clips.map(c=>[c.id,c]));
  validateSession(session,clips);validateCoverage(session);assertClipRatings(session,clips);assertClipReviews(session,clips);
  for(const p of session.placements){
    const c=byId.get(p.clip_id),section=session.sections.find(s=>s.id===p.section_id);
    const kept=section.locked||section.planned_regions&&p.locked;
    if(!c||c.available===false||!hasMotionForSection(c,section)||(!kept&&(c.retired||!matchesSection(c,section)))||asset(c)!==proposal.assets[c.id])
      throw new Error('A proposed clip changed or is no longer ready. Assemble again to review the current draft choices.');
  }
  return clone(session);
}
