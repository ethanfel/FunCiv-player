import { arrange, isDraftClip, hasMotionForSection, videoIdentities } from './index.mjs';

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
  return {session:next,assembled,draftCount:new Set(drafts.map(c=>identities.get(c.id))).size,fetchIds};
}
