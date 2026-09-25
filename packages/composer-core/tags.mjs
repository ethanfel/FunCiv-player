import { videoIdentities } from './video-identity.mjs';

export const MAX_PREFERRED_TAGS=32;
export const tagKey=value=>value.normalize('NFKC').toLowerCase().replaceAll('_',' ').replace(/\s+/gu,' ').trim();
export function normalizeTags(value,limit=500){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>limit||value.some(t=>typeof t!=='string'||t.length>120||/[\x00-\x1f\x7f]/.test(t)))throw new Error(`Use at most ${limit} text tags, each up to 120 characters.`);
  const tags=[...new Set(value.map(tagKey).filter(Boolean))].sort();
  if(tags.some(t=>t.length>120))throw new Error('Normalized tags must be at most 120 characters.');
  return tags;
}
export function normalizeTagSources(value,tags){
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>20)throw new Error('Invalid dataset tag sources.');
  const allowed=new Set(tags);
  return Object.fromEntries(Object.entries(value).map(([source,values])=>{
    if(!/^[a-z][a-z0-9_-]{0,63}$/.test(source))throw new Error('Invalid dataset tag source name.');
    return [source,normalizeTags(values).filter(tag=>allowed.has(tag))];
  }));
}
export function validateTagPreferences(value,{section=false}={}){
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid tag preferences.');
  if(section&&!['add','replace','off'].includes(value.mode))throw new Error('Choose how section tags use session preferences.');
  for(const field of ['prefer','less']){
    const tags=normalizeTags(value[field],MAX_PREFERRED_TAGS);
    if(!Array.isArray(value[field])||JSON.stringify(tags)!==JSON.stringify(value[field]))throw new Error('Tag preferences must be unique, normalized and sorted.');
  }
  if(value.prefer.some(tag=>value.less.includes(tag)))throw new Error('A tag cannot be preferred both more and less.');
}
export function effectiveTagPreferences(session,section){
  const local=section?.tag_preferences;
  if(local?.mode==='off')return {prefer:[],less:[]};
  const base=local?.mode==='replace'?{}:session.tag_preferences||{};
  const prefer=new Set(base.prefer||[]),less=new Set(base.less||[]);
  for(const tag of local?.prefer||[]){less.delete(tag);prefer.add(tag);}
  for(const tag of local?.less||[]){prefer.delete(tag);less.add(tag);}
  return {prefer:[...prefer].sort(),less:[...less].sort()};
}

/** Tags describe a video, so linked local copies share published HF labels.
 * Retired variants cannot resurrect tags removed from the current catalog. */
export function clipTagIndex(clips,identities=videoIdentities(clips)){
  const groups=new Map();
  for(const clip of clips){
    if(clip.retired)continue;
    const key=identities.get(clip.id);if(!groups.has(key))groups.set(key,new Set());
    for(const tag of clip.tags||[])groups.get(key).add(tagKey(tag));
  }
  return new Map(clips.map(clip=>[clip.id,[...(groups.get(identities.get(clip.id))||[])].sort()]));
}
export function tagPreferenceScore(tags,preferences){
  const available=new Set(tags||[]);
  return preferences.prefer.reduce((sum,tag)=>sum+Number(available.has(tag)),0)-preferences.less.reduce((sum,tag)=>sum+Number(available.has(tag)),0);
}
export function tagPreferenceLabel(value){
  return `${value?.prefer?.length||0} preferred · ${value?.less?.length||0} less often`;
}
