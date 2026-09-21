/** Group HF variants and local copies of the same source video. */
export function videoIdentities(clips){
  const parents=new Map(),find=key=>{if(!parents.has(key))parents.set(key,key);const parent=parents.get(key);if(parent!==key)parents.set(key,find(parent));return parents.get(key);};
  const keys=clip=>[`clip:${clip.id}`,...(clip.civitai_id?[`civitai:${clip.civitai_id}`]:[]),...(clip.path||clip.url?[`file:${clip.path||clip.url}`]:[])];
  for(const clip of clips){const [first,...rest]=keys(clip);for(const key of rest)parents.set(find(key),find(first));}
  return new Map(clips.map(clip=>[clip.id,find(`clip:${clip.id}`)]));
}
