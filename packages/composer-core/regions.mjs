import { matchesFolders } from './folders.mjs';
export const MIN_REGION_MS = 100;
export const sectionCategories = section => section.categories ?? (section.category && section.category !== '*' ? [section.category] : []);
export const matchesSection = (clip, section) => matchesFolders(clip, section.folders) &&
  (!sectionCategories(section).length || sectionCategories(section).some(c => (clip.categories || []).includes(c)));
export const sectionRegions = (session, section) => session.placements.filter(p => p.section_id === section.id).sort((a,b) => a.start_ms-b.start_ms);

export function validateRegionCoverage(section, regions) {
  let end=section.start_ms;
  for(const p of regions){if(p.start_ms!==end)throw new Error('Clip regions must meet without gaps or overlaps.');end=p.end_ms;}
  if(end!==section.end_ms)throw new Error('Clip regions must cover their section.');
}

function sectionFor(session,id){const s=session.sections.find(s=>s.id===id);if(!s)throw new Error('Select a section first.');return s;}
function emptyRegion(section,start,end){return {id:crypto.randomUUID(),section_id:section.id,clip_id:null,start_ms:start,end_ms:end,source_in_ms:0,rate:1};}

/** Explicit song boundaries remain fixed when clips are assembled or varied. */
export function planRegions(session,sectionId,cuts){
  const next=structuredClone(session),section=sectionFor(next,sectionId),old=sectionRegions(next,section);
  if(section.locked)throw new Error('Unlock the section before replacing region boundaries.');
  const bounds=[section.start_ms,...cuts,section.end_ms];
  if(bounds.length>5001||bounds.some((at,i)=>!Number.isInteger(at)||(i&&at-bounds[i-1]<MIN_REGION_MS)))throw new Error('Cuts must be ordered, inside the section, and at least 100 ms apart.');
  if(old.some(p=>p.locked&&bounds[bounds.indexOf(p.start_ms)+1]!==p.end_ms))throw new Error('Unlock kept clips whose boundaries would change.');
  const regions=bounds.slice(0,-1).map((start,i)=>{
    const end=bounds[i+1],same=old.find(p=>p.start_ms===start&&p.end_ms===end);
    return same||emptyRegion(section,start,end);
  });
  next.placements=next.placements.filter(p=>p.section_id!==sectionId).concat(regions).sort((a,b)=>a.start_ms-b.start_ms);
  section.planned_regions=true;delete next.asset_bindings;return next;
}

export function splitRegion(session,sectionId,at){
  let next=structuredClone(session),section=sectionFor(next,sectionId);
  if(section.locked)throw new Error('Unlock the section before editing regions.');
  if(!sectionRegions(next,section).length)next=planRegions(next,sectionId,[]);
  section=sectionFor(next,sectionId);
  const index=next.placements.findIndex(p=>p.section_id===sectionId&&at>p.start_ms&&at<p.end_ms),p=next.placements[index];
  if(!p||!Number.isInteger(at)||at-p.start_ms<MIN_REGION_MS||p.end_ms-at<MIN_REGION_MS)throw new Error('Place a cut inside a region, at least 100 ms from its ends.');
  const right={...p,id:crypto.randomUUID(),start_ms:at,source_in_ms:p.clip_id?p.source_in_ms+(at-p.start_ms)*p.rate:0};
  p.end_ms=at;next.placements.splice(index+1,0,right);section.planned_regions=true;delete next.asset_bindings;return next;
}

export function mergeRegion(session,id,clips){
  const next=structuredClone(session),p=next.placements.find(p=>p.id===id);if(!p)throw new Error('Select a clip region.');
  const section=sectionFor(next,p.section_id),regions=sectionRegions(next,section),right=regions[regions.indexOf(p)+1];
  if(section.locked||p.locked||right?.locked)throw new Error('Unlock these clips and their section before merging.');
  if(!right)throw new Error('Choose a region with another region after it in the same section.');
  p.end_ms=right.end_ms;
  const clip=clips.find(c=>c.id===p.clip_id);
  if(!clip||p.source_in_ms+(p.end_ms-p.start_ms)*p.rate>clip.duration_ms){p.clip_id=null;p.source_in_ms=0;p.rate=1;}
  next.placements=next.placements.filter(r=>r.id!==right.id);section.planned_regions=true;delete next.asset_bindings;return next;
}

/** Roll an internal song cut. The two regions stay contiguous; source offsets stay fixed. */
export function moveRegionEdge(session,id,edge,at,clips){
  const next=structuredClone(session),p=next.placements.find(p=>p.id===id);if(!p)throw new Error('Select a clip region.');
  const section=sectionFor(next,p.section_id),regions=sectionRegions(next,section),index=regions.indexOf(p);
  if(section.locked)throw new Error('Unlock the section before moving its clip boundaries.');
  const left=edge==='start'?regions[index-1]:p,right=edge==='start'?p:regions[index+1];
  if(!['start','end'].includes(edge)||!left||!right)throw new Error('Section edges are fixed here. Edit the section boundary to move them.');
  const capacity=p=>{if(!p.clip_id)return Infinity;const c=clips.find(c=>c.id===p.clip_id);if(!c)throw new Error('Relink the selected clip first.');return (c.duration_ms-p.source_in_ms)/p.rate;};
  const low=Math.ceil(Math.max(left.start_ms+MIN_REGION_MS,right.end_ms-capacity(right)));
  const high=Math.floor(Math.min(right.end_ms-MIN_REGION_MS,left.start_ms+capacity(left)));
  if(!Number.isFinite(at)||low>high)throw new Error('These clips have no spare source duration at this cut. Choose a longer clip or change its source start.');
  const boundary=Math.max(low,Math.min(high,Math.round(at)));left.end_ms=boundary;right.start_ms=boundary;
  section.planned_regions=true;delete next.asset_bindings;return next;
}

/** Slip a source window without changing its song duration or playback rate. */
export function slipSource(session,id,sourceIn,clips){
  const next=structuredClone(session),p=next.placements.find(p=>p.id===id),clip=clips.find(c=>c.id===p?.clip_id);
  if(!p||!clip)throw new Error('Assign a clip before choosing its source portion.');
  const maximum=clip.duration_ms-(p.end_ms-p.start_ms)*p.rate;
  if(!Number.isFinite(sourceIn)||maximum<0)throw new Error('The source is too short for this region.');
  p.source_in_ms=Math.max(0,Math.min(maximum,Math.round(sourceIn)));p.locked=true;
  sectionFor(next,p.section_id).planned_regions=true;delete next.asset_bindings;return next;
}

const clipGaps=(section,start,end)=>(section.gaps||[]).map(([a,b])=>[Math.max(a,start),Math.min(b,end)]).filter(([a,b])=>b>a);
function cutPlacement(p,at){return [{...p,end_ms:at},{...p,id:crypto.randomUUID(),start_ms:at,source_in_ms:p.clip_id?p.source_in_ms+(at-p.start_ms)*p.rate:0}];}
const defaultSectionName=label=>/^Section \d+(?: B)*$/.test(label);
export function normalizeSectionNames(session){
  const next=structuredClone(session);
  next.sections.forEach((section,index)=>{if(section.auto_label!==false&&defaultSectionName(section.label))section.label=`Section ${index+1}`;});
  return next;
}
function splitName(sections,{label,auto_label}){
  if(auto_label!==false&&defaultSectionName(label))return label;
  const base=String(label).replace(/ \(\d+\)$/,'');let number=2;
  while(sections.some(s=>s.label===`${base} (${number})`))number++;
  return `${base} (${number})`;
}

export function splitSongSection(session,at){
  const next=structuredClone(session),index=next.sections.findIndex(s=>at>s.start_ms&&at<s.end_ms),before=next.sections[index];
  if(!before||!Number.isInteger(at)||at-before.start_ms<MIN_REGION_MS||before.end_ms-at<MIN_REGION_MS)throw new Error('Split at least 100 ms inside a section.');
  if(before.locked)throw new Error('Unlock the section before splitting it.');
  const existing=sectionRegions(next,before),after={...structuredClone(before),id:crypto.randomUUID(),label:splitName(next.sections,before),start_ms:at};
  after.gaps=clipGaps(before,at,before.end_ms);before.gaps=clipGaps(before,before.start_ms,at);before.end_ms=at;
  before.planned_regions=after.planned_regions=!!existing.length;
  next.sections.splice(index+1,0,after);
  next.placements=next.placements.flatMap(p=>p.section_id===before.id&&p.start_ms<at&&p.end_ms>at?cutPlacement(p,at):[p]);
  for(const p of next.placements)if(p.section_id===before.id&&p.start_ms>=at)p.section_id=after.id;
  delete next.asset_bindings;return normalizeSectionNames(next);
}

export function mergeSongSections(session,index){
  const next=structuredClone(session),before=next.sections[index],after=next.sections[index+1];
  if(!before||!after)throw new Error('Select a section with another section after it.');
  if(before.locked||after.locked)throw new Error('Unlock both sections before merging them.');
  const a=sectionRegions(next,before),b=sectionRegions(next,after);
  if(a.length||b.length){
    if(!a.length)next.placements.push(emptyRegion(before,before.start_ms,before.end_ms));
    if(!b.length)next.placements.push(emptyRegion(after,after.start_ms,after.end_ms));
    before.planned_regions=true;
  }
  const ac=sectionCategories(before),bc=sectionCategories(after);before.categories=ac.length&&bc.length?[...new Set([...ac,...bc])]:[];delete before.category;
  const af=before.folders||[],bf=after.folders||[];
  before.folders=af.length&&bf.length?[...new Map([...af,...bf].map(f=>[JSON.stringify([f.source,f.path]),f])).values()]:[];
  before.end_ms=after.end_ms;before.gaps=[...(before.gaps||[]),...(after.gaps||[])];
  for(const p of next.placements)if(p.section_id===after.id)p.section_id=before.id;
  next.placements.sort((a,b)=>a.start_ms-b.start_ms);next.sections.splice(index+1,1);delete next.asset_bindings;return normalizeSectionNames(next);
}

export function resizeSongSection(session,sectionId,at,clips){
  const next=structuredClone(session),index=next.sections.findIndex(s=>s.id===sectionId),before=next.sections[index],after=next.sections[index+1];
  if(!before||!after||!Number.isInteger(at)||at-before.start_ms<MIN_REGION_MS||after.end_ms-at<MIN_REGION_MS)throw new Error('Choose a section boundary inside these two sections.');
  if(before.locked||after.locked)throw new Error('Unlock both sections before moving their shared boundary.');
  if(at===before.end_ms)return next;
  const a=sectionRegions(next,before),b=sectionRegions(next,after);
  if(a.length||b.length){
    if(!a.length)next.placements.push(emptyRegion(before,before.start_ms,before.end_ms));
    if(!b.length)next.placements.push(emptyRegion(after,after.start_ms,after.end_ms));
    next.placements=next.placements.flatMap(p=>[before.id,after.id].includes(p.section_id)&&p.start_ms<at&&p.end_ms>at?cutPlacement(p,at):[p]);
    for(const p of next.placements)if([before.id,after.id].includes(p.section_id)){
      const section=p.start_ms<at?before:after;p.section_id=section.id;
      const clip=clips.find(c=>c.id===p.clip_id);if(clip&&!matchesSection(clip,section)){p.clip_id=null;p.source_in_ms=0;p.rate=1;p.locked=false;}
    }
    before.planned_regions=after.planned_regions=true;
  }
  before.gaps=clipGaps(before,before.start_ms,at);after.gaps=clipGaps(after,at,after.end_ms);
  before.end_ms=at;after.start_ms=at;next.placements.sort((a,b)=>a.start_ms-b.start_ms);delete next.asset_bindings;return next;
}
