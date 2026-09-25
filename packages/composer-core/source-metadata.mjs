import { videoIdentities } from './video-identity.mjs';

export const sourceKey=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
export const SOURCE_FACETS={creators:'Creators',base_models:'Source models',content_ratings:'Civitai content ratings',orientations:'Source orientation'};
const text=(value,label)=>{
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||value.length>200||/[\x00-\x1f\x7f]/.test(value))throw new Error(`Invalid Civitai ${label}.`);
  const result=value.normalize('NFKC').trim();if(result.length>200)throw new Error(`Invalid Civitai ${label}.`);return result||null;
};
const id=value=>{if(!/^[1-9]\d{0,15}$/.test(String(value)))throw new Error('Invalid Civitai identifier.');return String(value);};
const stats=['cryCount','laughCount','likeCount','dislikeCount','heartCount','commentCount','collectedCount'];
export function normalizeSourceMetadata(row){
  const creator_username=text(row.creator_username,'creator'),post_id=row.post_id==null?null:id(row.post_id),raw=row.civitai_metadata??{};
  if(typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid Civitai metadata.');
  const civitai_metadata={};
  for(const key of ['base_model','content_rating','created_at','fetched_at','site']){
    const value=text(raw[key],key);if(value!==null)civitai_metadata[key]=value;
  }
  for(const key of ['created_at','fetched_at'])if(civitai_metadata[key]&&!Number.isFinite(Date.parse(civitai_metadata[key])))throw new Error('Invalid Civitai date.');
  for(const key of ['width','height'])if(raw[key]!=null){
    if(!Number.isInteger(raw[key])||raw[key]<=0||raw[key]>100000)throw new Error('Invalid Civitai source dimensions.');
    civitai_metadata[key]=raw[key];
  }
  if(raw.model_version_ids!==undefined){
    if(!Array.isArray(raw.model_version_ids)||raw.model_version_ids.length>1000)throw new Error('Invalid Civitai model versions.');
    civitai_metadata.model_version_ids=[...new Set(raw.model_version_ids.map(id))].sort();
  }
  if(raw.stats!==undefined){
    if(!raw.stats||typeof raw.stats!=='object'||Array.isArray(raw.stats))throw new Error('Invalid Civitai statistics.');
    civitai_metadata.stats={};
    for(const key of stats)if(raw.stats[key]!==undefined){
      if(!Number.isSafeInteger(raw.stats[key])||raw.stats[key]<0)throw new Error('Invalid Civitai statistic.');
      civitai_metadata.stats[key]=raw.stats[key];
    }
  }
  // Build public page addresses from validated identifiers. Published URLs
  // never become media paths, API endpoints, or arbitrary external links.
  const site=civitai_metadata.site;
  if(['civitai.com','civitai.red','civitaired.com'].includes(site)){
    if(row.civitai_id)civitai_metadata.video_url=`https://${site}/images/${id(row.civitai_id)}`;
    if(post_id)civitai_metadata.post_url=`https://${site}/posts/${post_id}`;
    if(creator_username)civitai_metadata.creator_url=`https://${site}/user/${encodeURIComponent(creator_username)}/images`;
  }
  return {creator_username,post_id,civitai_metadata};
}

/** Current HF metadata is shared by a video's linked local/script variants.
 * Choose one newest record, so a newly cleared field is not resurrected. */
export function clipMetadataIndex(clips,identities=videoIdentities(clips)){
  const groups=new Map();
  for(const clip of clips){const key=identities.get(clip.id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(clip);}
  const index=new Map();
  for(const group of groups.values()){
    const current=group.filter(c=>!c.retired),candidates=(current.length?current:group).filter(c=>c.origin==='dataset'||c.creator_username||c.civitai_metadata);
    candidates.sort((a,b)=>(Date.parse(b.civitai_metadata?.fetched_at)||0)-(Date.parse(a.civitai_metadata?.fetched_at)||0)||Number(b.origin==='dataset')-Number(a.origin==='dataset')||String(a.id).localeCompare(String(b.id)));
    const chosen=candidates[0];
    for(const clip of group)index.set(clip.id,chosen?{creator_username:chosen.creator_username??null,post_id:chosen.post_id??null,civitai_metadata:chosen.civitai_metadata||{}}:{creator_username:null,post_id:null,civitai_metadata:{}});
  }
  return index;
}
export function sourceValues(clip,index){
  const record=index?.get(clip.id)||clip,meta=record.civitai_metadata||{};
  const width=meta.width||clip.width,height=meta.height||clip.height,known=Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0;
  return {creators:record.creator_username||'',base_models:meta.base_model||'',content_ratings:meta.content_rating||'',
    orientations:known?(width>height?'landscape':width<height?'portrait':'square'):'',min_short_edge:known?Math.min(width,height):0};
}
export function validateSourceFilters(value,{section=false}={}){
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid source filters.');
  if(section&&!['narrow','replace','off'].includes(value.mode))throw new Error('Choose how this section uses source filters.');
  for(const field of Object.keys(SOURCE_FACETS))if(value[field]!==undefined){
    const list=value[field];
    if(!Array.isArray(list)||list.length>128||list.some(v=>typeof v!=='string'||v.length>200||/[\x00-\x1f\x7f]/.test(v)||v!==sourceKey(v))||JSON.stringify([...new Set(list)].sort())!==JSON.stringify(list))throw new Error('Source filter choices must be unique, normalized and sorted.');
    if(field==='orientations'&&list.some(v=>!['','portrait','landscape','square'].includes(v)))throw new Error('Choose a valid source orientation.');
  }
  if(value.min_short_edge!==undefined&&(!Number.isInteger(value.min_short_edge)||value.min_short_edge<0||value.min_short_edge>100000))throw new Error('Minimum source resolution must be between 0 and 100000 pixels.');
}
export function sourceRules(session={},section){
  const local=section?.source_filters;
  if(local?.mode==='off')return [];
  if(local?.mode==='replace')return [local];
  return [session.source_filters,local].filter(Boolean);
}
export function matchesSourceRules(clip,rules,index){
  const values=sourceValues(clip,index);
  return rules.every(rule=>Object.keys(SOURCE_FACETS).every(field=>!rule[field]?.length||rule[field].includes(sourceKey(values[field])))&&values.min_short_edge>=(rule.min_short_edge||0));
}
export const matchesSourceFilters=(clip,session,section,index)=>matchesSourceRules(clip,sourceRules(session,section),index);
export const sourceFilterCount=value=>Object.keys(SOURCE_FACETS).reduce((n,key)=>n+(value?.[key]?.length||0),0)+Number(!!value?.min_short_edge);
export function sourceFilterConflicts(session,clips,index=clipMetadataIndex(clips)){
  const byId=new Map(clips.map(c=>[c.id,c]));
  return session.placements.filter(p=>{const c=byId.get(p.clip_id);return c&&!matchesSourceFilters(c,session,session.sections.find(s=>s.id===p.section_id),index);});
}
