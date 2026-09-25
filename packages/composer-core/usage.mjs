import { videoIdentities } from './video-identity.mjs';

// Recovery advances with completed compositions, never with wall-clock time,
// ordinary previews, edits, or failed exports/device uploads.
export const RECOVERY_COMPOSITIONS=5;
export const createUsage=()=>({version:1,sequence:0,events:{},videos:{}});
export const videoAliases=clip=>[
  ...(clip.civitai_id?[`civitai:${clip.civitai_id}`]:[]),
  ...(clip.path||clip.url?[`file:${clip.path||clip.url}`]:[]),`clip:${clip.id}`,
  ...(clip.local_video_id?[`clip:${clip.local_video_id}`]:[])
];

function groups(clips){
  const ids=videoIdentities(clips),result=new Map();
  for(const clip of clips){const id=ids.get(clip.id);if(!result.has(id))result.set(id,[]);result.get(id).push(clip);}
  return result;
}
function previous(usage,aliases){
  const values=aliases.map(a=>usage.videos[a]).filter(Boolean);
  return {last:Math.max(0,...values.map(v=>v.last)),count:Math.max(0,...values.map(v=>v.count))};
}
export function usageByClip(clips,usage=createUsage()){
  const result=new Map();
  for(const members of groups(clips).values()){
    const record=previous(usage,members.flatMap(videoAliases));
    const age=record.last?Math.max(0,usage.sequence-record.last):RECOVERY_COMPOSITIONS;
    const weight=record.last?Math.round(20+80*Math.min(1,age/RECOVERY_COMPOSITIONS)):100;
    for(const c of members)result.set(c.id,{...record,weight,recovery_remaining:Math.max(0,RECOVERY_COMPOSITIONS-age)});
  }
  return result;
}
export function recordUsage(usage,event,clips,clipIds){
  if(Object.hasOwn(usage.events,event))return usage;
  const selected=new Set(clipIds),next=structuredClone(usage);next.sequence++;
  next.events[event]=next.sequence;
  for(const members of groups(clips).values())if(members.some(c=>selected.has(c.id))){
    const aliases=[...new Set(members.flatMap(videoAliases))],old=previous(next,aliases);
    for(const alias of aliases)next.videos[alias]={last:next.sequence,count:old.count+1};
  }
  return next;
}
// One shared score for linked variants; ratings stay variant-specific. Integer
// scores preserve the exact ordering required by the global assignment solver.
export function selectionPriorities(clips,rating){
  const result=new Map();
  for(const members of groups(clips).values()){
    const weight=Math.min(...members.map(c=>Number.isFinite(c.usage?.weight)?Math.max(20,Math.min(100,c.usage.weight)):100));
    for(const c of members)result.set(c.id,Math.round((rating(c)+1)*weight));
  }
  return result;
}
