import { evaluate } from '../../vendor/motion-studio/curve.mjs';
import { spliceActions } from '../../vendor/motion-studio/timeline.mjs';
import { musicMotion, validateMusic } from './music.mjs';
export { createMusic, DEFAULT_MUSIC_SETTINGS, generateMusicBlock, replaceMusicRange, musicMotion } from './music.mjs';
import { DEFAULT_OUTPUT, outputSettings } from './output.mjs';
export { DEFAULT_OUTPUT, OUTPUT_PRESETS, outputSettings } from './output.mjs';
import { sectionCategories, matchesSection, sectionRegions, validateRegionCoverage } from './regions.mjs';
import { videoIdentities } from './video-identity.mjs';
import { clipTagIndex, effectiveTagPreferences, tagPreferenceScore, validateTagPreferences } from './tags.mjs';
import { clipMetadataIndex, matchesSourceFilters, validateSourceFilters } from './source-metadata.mjs';
export { normalizeSourceMetadata } from './source-metadata.mjs';
export { normalizeTags, normalizeTagSources } from './tags.mjs';
import { assignUnique } from './unique-assignment.mjs';
import { selectionPriorities } from './usage.mjs';
import { validateFolders } from './folders.mjs';
import { validateAutoClips, checkAutoSection, balanceAutoClips } from './auto-clips.mjs';
export { DEFAULT_AUTO_CLIPS } from './auto-clips.mjs';
export { videoIdentities } from './video-identity.mjs';
export { sectionCategories, matchesSection, sectionRegions, planRegions, splitRegion, mergeRegion, moveRegionEdge, slipSource, splitSongSection, mergeSongSections, resizeSongSection, normalizeSectionNames } from './regions.mjs';
export { audioChangeMarkers, snapToAudio, suggestRegionCuts } from './audio-cuts.mjs';

export const SCHEMA = 'funciv-session/1';
export const AXES = ['L0', 'L1', 'L2', 'R0', 'R1', 'R2'];
export const SUFFIX = { L0: '', L1: '.surge', L2: '.sway', R0: '.twist', R1: '.roll', R2: '.pitch' };
const finite = (n, label) => { if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number.`); return n; };
export const clone = value => structuredClone(value);
const validRating = value => Number.isInteger(value) && value >= 0 && value <= 5;
/** Ratings belong to a script variant. An explicit local override of zero means unrated. */
export const clipRating = clip => validRating(clip?.user_rating) ? clip.user_rating : validRating(clip?.quality) ? clip.quality : 0;
export const clipIntensity = clip => validRating(clip?.intensity) ? clip.intensity : 0;
export const isDraftClip = clip => clip?.review_status === 'draft' || (clip?.origin === 'dataset' && clip.review_status !== 'approved');
export const allowsClipReview = (session, clip) => session.include_drafts === true || !isDraftClip(clip);
export const isAudioSyncClip = clip => clip?.audio_sync === true;
export const hasMotionForSection = (clip, section) => ['song','hold'].includes(section.motion) || isAudioSyncClip(clip) || !!(clip.scripts?.L0 || clip.script_ready);

export function assertClipReviews(session, clips) {
  const byId = new Map(clips.map(c => [c.id, c]));
  for (const p of session.placements || []) {
    const clip = byId.get(p.clip_id);
    if (clip && !allowsClipReview(session, clip)) throw new Error(`${clip.name}: draft scripts are disabled for this session. Enable Include draft scripts, or unlock and replace the affected clips.`);
  }
}

export function assertClipRatings(session, clips) {
  const minimum = session.min_rating ?? 0, byId = new Map(clips.map(c => [c.id, c]));
  for (const p of session.placements || []) {
    if(p.clip_id===null)continue;
    const clip = byId.get(p.clip_id);
    if (clipRating(clip) < minimum) throw new Error(`${clip?.name || 'A selected clip'} is below the ${minimum}★ minimum. Unlock affected sections and assemble again, or replace the clip.`);
  }
}

export function validateActions(actions) {
  if (!Array.isArray(actions) || !actions.length) throw new Error('A script needs at least one action.');
  let previous = -1;
  for (const p of actions) {
    if (!Number.isInteger(p.at) || p.at < 0 || p.at <= previous || !Number.isFinite(p.pos) || p.pos < 0 || p.pos > 100)
      throw new Error('Script actions must have unique increasing millisecond times and positions from 0 to 100.');
    previous = p.at;
  }
  return actions;
}

export function createSession(song, count = 6) {
  const duration = Math.round(finite(song.duration_ms, 'Song duration'));
  if (duration < 1000) throw new Error('Choose a song at least one second long.');
  count = Math.max(1, Math.min(Math.floor(count), Math.floor(duration / 1000)));
  return { schema: SCHEMA, id: crypto.randomUUID(), revision: 0, name: song.name.replace(/\.[^.]+$/, ''),
    song: clone(song), seed: 1, blend_ms: 150, min_rating: 0, include_drafts: false, repeat_policy:'never', output:clone(DEFAULT_OUTPUT), analysis: null, placements: [],
    sections: Array.from({ length: count }, (_, i) => ({ id: crypto.randomUUID(), label: `Section ${i + 1}`,
      start_ms: Math.round(duration * i / count), end_ms: Math.round(duration * (i + 1) / count),
      category: '*', motion: 'clip', strength: 100, locked: false, gaps: [] })) };
}

export function validateSession(session, clips = null) {
  if (session?.schema !== SCHEMA || !Array.isArray(session.sections) || !session.sections.length) throw new Error('Unsupported or empty session.');
  if(!Array.isArray(session.placements)||session.placements.length>5000)throw new Error('A session needs a list of at most 5000 clip regions.');
  if (!session.song?.id || !(finite(session.song.duration_ms, 'Duration') > 0)) throw new Error('Song is missing.');
  const sectionIds = new Set(); let end = 0;
  for (const s of session.sections) {
    if (!s.id || sectionIds.has(s.id)) throw new Error('Section IDs must be unique.');
    sectionIds.add(s.id);
    if (![s.start_ms, s.end_ms].every(Number.isInteger) || s.start_ms !== end || s.end_ms <= s.start_ms) throw new Error('Sections must cover the song without gaps or overlaps.');
    if (!['clip', 'song', 'gaps', 'hold'].includes(s.motion)) throw new Error('Unknown motion policy.');
    if (!Number.isFinite(s.strength) || s.strength < 0 || s.strength > 100) throw new Error('Strength must be 0–100.');
    const categories=sectionCategories(s);
    validateFolders(s.folders);
    validateTagPreferences(s.tag_preferences,{section:true});
    validateSourceFilters(s.source_filters,{section:true});
    if(!Array.isArray(categories)||categories.some(c=>typeof c!=='string'||!c.trim()||c.length>160)||new Set(categories).size!==categories.length)throw new Error('Choose valid, unique folder categories for the section.');
    if(s.planned_regions)validateRegionCoverage(s,sectionRegions(session,s));
    end = s.end_ms;
  }
  if (end !== Math.round(session.song.duration_ms)) throw new Error('Sections must end at the song duration.');
  if (!Number.isFinite(session.blend_ms) || session.blend_ms < 0 || session.blend_ms > 2000) throw new Error('Blend must be between 0 and 2000 ms.');
  if (session.bpm !== undefined && (!Number.isFinite(session.bpm) || session.bpm < 30 || session.bpm > 300)) throw new Error('BPM must be between 30 and 300.');
  if (!Number.isInteger(session.seed) || !Number.isInteger(session.revision) || session.revision < 0) throw new Error('Invalid seed or revision.');
  if (session.min_rating !== undefined && !validRating(session.min_rating)) throw new Error('Minimum rating must be an integer from 0 to 5.');
  if (session.include_drafts !== undefined && typeof session.include_drafts !== 'boolean') throw new Error('Include draft scripts must be true or false.');
  if (session.repeat_policy !== undefined && !['never','cycle'].includes(session.repeat_policy)) throw new Error('Choose a valid video repeat policy.');
  outputSettings(session);
  validateAutoClips(session.auto_clip);
  validateTagPreferences(session.tag_preferences);
  validateSourceFilters(session.source_filters);
  validateMusic(session.music,session.song.duration_ms);
  const byId = clips && new Map(clips.map(c => [c.id, c]));
  const ids = new Set();
  for (const p of session.placements || []) {
    if (!p.id || ids.has(p.id)) throw new Error('Placement IDs must be unique.');
    ids.add(p.id);
    const s = session.sections.find(s => s.id === p.section_id);
    if (!s || ![p.start_ms, p.end_ms, p.source_in_ms, p.rate].every(Number.isFinite) || p.start_ms < s.start_ms || p.end_ms > s.end_ms || p.end_ms <= p.start_ms || p.source_in_ms < 0 || p.rate < .25 || p.rate > 4) throw new Error('A clip has invalid source or song bounds.');
    if(p.clip_id===null){if(!s.planned_regions)throw new Error('Empty clips must belong to planned regions.');continue;}
    if(typeof p.clip_id!=='string'||!p.clip_id)throw new Error('Choose a valid clip for this region.');
    if (byId) {
      const clip = byId.get(p.clip_id);
      if (!clip) throw new Error('A selected clip is unavailable. Relink or assemble again.');
      if (sourceTime(p, p.end_ms) > clip.duration_ms + 1) throw new Error(`The selected range exceeds ${clip.name}.`);
    }
  }
  return session;
}

export const sourceTime = (p, time) => p.source_in_ms + (time - p.start_ms) * p.rate;
export const songTime = (p, time) => p.start_ms + (time - p.source_in_ms) / p.rate;

/** Trim in source time before converting; round once at the output boundary. */
export function remapActions(actions, placement, strength = 100) {
  validateActions(actions);
  const p = placement, sourceEnd = sourceTime(p, p.end_ms);
  const mapped = [{ at: p.start_ms, pos: evaluate(actions, p.source_in_ms) },
    ...actions.filter(a => a.at > p.source_in_ms && a.at < sourceEnd).map(a => ({ at: songTime(p, a.at), pos: a.pos })),
    { at: p.end_ms, pos: evaluate(actions, sourceEnd) }];
  return [...new Map(mapped.map(a => [Math.round(a.at), { at: Math.round(a.at), pos: Math.round(50 + (a.pos - 50) * strength / 100) }])).values()].sort((a,b) => a.at - b.at);
}

function random(seed) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

export function arrange(session, clips) {
  validateSession(session);
  const result = clone(session), rng = random(session.seed), placements = [];
  const identities=videoIdentities(clips),key=id=>identities.get(id)||`clip:${id}`,uses=new Map();
  const priorities=selectionPriorities(clips,clipRating),priority=c=>priorities.get(c.id);
  const tags=clipTagIndex(clips,identities),preferences=new Map(session.sections.map(s=>[s.id,effectiveTagPreferences(session,s)]));
  const metadata=clipMetadataIndex(clips,identities),matchesSource=(clip,section)=>matchesSourceFilters(clip,session,section,metadata);
  const preference=(clip,section)=>tagPreferenceScore(tags.get(clip.id),preferences.get(section.id));
  const remember=id=>uses.set(key(id),(uses.get(key(id))||0)+1),noRepeats=session.repeat_policy!=='cycle';
  // Reserve all kept footage first, including sections later in the song.
  for(const s of session.sections)for(const p of sectionRegions(session,s))if(p.clip_id&&(s.locked||s.planned_regions&&p.locked))remember(p.clip_id);
  let previous = null, index = 0;
  const tasks=[];
  const pools=new Map(session.sections.map(section=>[section.id,clips.filter(c => !c.retired && allowsClipReview(session,c) && c.available !== false && c.duration_ms >= 100 && clipRating(c) >= (session.min_rating ?? 0) &&
    matchesSection(c,section)&&hasMotionForSection(c,section)&&matchesSource(c,section)).sort((a,b)=>a.id.localeCompare(b.id))]));
  const choose=(eligible,section,at)=>{
    let choices=eligible.filter(c=>!noRepeats||!uses.has(key(c.id)));
    if(!choices.length){const error=new Error(`Cannot fill ${section.label} at ${(at/1000).toFixed(1)} s without repeating a video. Add unique footage or allow matching drafts; your current timeline is unchanged.`);error.code='UNIQUE_FOOTAGE';error.section_id=section.id;throw error;}
    const minimum=Math.min(...choices.map(c=>uses.get(key(c.id))||0));choices=choices.filter(c=>(uses.get(key(c.id))||0)===minimum);
    const score=Math.max(...choices.map(priority));choices=choices.filter(c=>priority(c)===score);
    const tagScore=Math.max(...choices.map(c=>preference(c,section)));choices=choices.filter(c=>preference(c,section)===tagScore);
    const approved=choices.filter(c=>!isDraftClip(c));if(approved.length)choices=approved;
    const alternatives=choices.filter(c=>key(c.id)!==previous);if(alternatives.length)choices=alternatives;
    const groups=[...new Set(choices.map(c=>key(c.id)))],selected=groups[Math.floor(rng()*groups.length)];
    let variants=choices.filter(c=>key(c.id)===selected);const reviewed=variants.filter(c=>!isDraftClip(c));if(reviewed.length)variants=reviewed;
    const clip=variants[Math.floor(rng()*variants.length)];remember(clip.id);previous=key(clip.id);return clip;
  };
  for (const section of session.sections) {
    const existing=sectionRegions(session,section);
    if (section.locked) {
      if (!existing.length) throw new Error(`Unlock ${section.label} before its first assembly.`);
      if(existing.some(p=>!p.clip_id))throw new Error(`Unlock ${section.label} to fill its empty regions.`);
      validateRegionCoverage(section,existing);
      assertClipRatings({...session, placements:existing}, clips);
      assertClipReviews({...session, placements:existing}, clips);
      if(existing.some(p=>!matchesSource(clips.find(c=>c.id===p.clip_id)||{},section)))throw new Error(`Unlock ${section.label}: a kept clip is outside its source filters.`);
      placements.push(...clone(existing)); previous=key(existing.at(-1).clip_id); continue;
    }
    const pacing=!section.planned_regions?session.auto_clip:undefined;
    checkAutoSection(section,pacing);
    const pool = pools.get(section.id).filter(c=>!pacing||c.duration_ms>=pacing.min_ms);
    if (!pool.length&&!section.planned_regions) throw new Error(`No usable clips for ${section.label}${session.min_rating ? ` at ${session.min_rating}★ or higher` : ''}. Check source filters, minimum rating, drafts and category; resolve videos${['clip','gaps'].includes(section.motion) ? ' with L0 scripts, or use Follow song' : ''}.`);
    if(section.planned_regions){
      validateRegionCoverage(section,existing);
      for(const region of existing){
        if(region.locked&&region.clip_id){
          const c=clips.find(c=>c.id===region.clip_id);
          if(c&&!matchesSource(c,section))throw new Error('A kept clip is outside this section’s source filters. Unlock it before assembling.');
          if(!c||c.available===false||!allowsClipReview(session,c)||clipRating(c)<(session.min_rating??0)||!matchesSection(c,section)||!hasMotionForSection(c,section))throw new Error('A kept clip no longer matches this section’s category, rating, draft or motion filters. Unlock it before assembling.');
          placements.push(clone(region));previous=key(region.clip_id);continue;
        }
        const required=(region.end_ms-region.start_ms)*region.rate,eligible=pool.filter(c=>c.duration_ms>=required);
        if(!eligible.length)throw new Error(`No clip is long enough for ${section.label}, ${(region.start_ms/1000).toFixed(2)}–${(region.end_ms/1000).toFixed(2)} s with the current filters. Check source filters, shorten or split this region, or select a folder with longer clips.`);
        if(noRepeats){tasks.push({section,region,pool:eligible,start_ms:region.start_ms,end_ms:region.end_ms});continue;}
        const clip=choose(eligible,section,region.start_ms);
        placements.push({...clone(region),clip_id:clip.id,source_in_ms:Math.floor(rng()*Math.max(0,clip.duration_ms-required))});
      }
      continue;
    }
    if(noRepeats){tasks.push({section,pool,pacing,start_ms:section.start_ms,end_ms:section.end_ms});continue;}
    if(pacing&&new Set(pool.map(c=>key(c.id))).size<2)throw new Error(`${section.label} needs at least two different source videos of ${pacing.min_ms/1000} s or longer. Add footage or use matching drafts.`);
    let start = section.start_ms,count=0,first=null;
    while (start < section.end_ms) {
      const remaining=section.end_ms-start,cap=c=>Math.min(Math.floor(c.duration_ms),pacing?.max_ms??Infinity);
      const eligible=pool.filter(c=>!pacing||(count!==1||key(c.id)!==first)&&
        (count<Math.floor((section.end_ms-section.start_ms)/pacing.min_ms)-1||cap(c)>=remaining));
      if(!eligible.length)throw new Error(`${section.label} cannot fit the available footage within the automatic clip length range. Add longer sources or adjust the range.`);
      const clip = choose(eligible,section,start);
      const end = start+Math.min(remaining,cap(clip),pacing&&count===0?remaining-pacing.min_ms:Infinity);
      placements.push({ id: `${section.id}-${index++}`, section_id: section.id, clip_id: clip.id,
        start_ms: start, end_ms: end, source_in_ms: 0, rate: 1 });
      start = end;if(count++===0)first=key(clip.id);
      if (placements.length > 5000) throw new Error('Session has too many cuts. Use longer clips.');
    }
  }
  if(noRepeats)for(const {task,clip,start_ms,end_ms} of assignUnique(tasks,{key,reserved:new Set(uses.keys()),rng,isDraft:isDraftClip,rating:priority,preference})){
    const region=task.region;
    placements.push(region?{...clone(region),clip_id:clip.id,source_in_ms:Math.floor(rng()*Math.max(0,clip.duration_ms-(end_ms-start_ms)*region.rate))}:
      {id:`${task.section.id}-${index++}`,section_id:task.section.id,clip_id:clip.id,start_ms,end_ms,source_in_ms:0,rate:1});
    if(placements.length>5000)throw new Error('Session has too many cuts. Use longer clips.');
  }
  balanceAutoClips(placements,session.sections,session.auto_clip);
  result.placements = placements.sort((a,b)=>a.start_ms-b.start_ms);
  delete result.asset_bindings; // A deliberate reassembly adopts the current catalog.
  validateSession(result, clips);
  return result;
}

export function validateCoverage(session) {
  if(session.placements.some(p=>!p.clip_id))throw new Error('Some clip regions are empty. Assemble or assign a clip to each region before playback.');
  let previous = 0;
  for (const p of [...session.placements].sort((a,b) => a.start_ms - b.start_ms)) {
    if (p.start_ms !== previous) throw new Error('Assemble every section before preparing playback.');
    previous = p.end_ms;
  }
  if (previous !== Math.round(session.song.duration_ms)) throw new Error('The video timeline does not cover the song. Assemble it first.');
}

function songMotion(session,section,start,end){
  return musicMotion(session,start,end,section.strength);
}

export function compile(session, clips) {
  validateSession(session, clips); validateCoverage(session); assertClipRatings(session, clips); assertClipReviews(session, clips);
  const duration = Math.round(session.song.duration_ms), byId = new Map(clips.map(c => [c.id,c]));
  const tracks = Object.fromEntries(AXES.map(axis => [axis, [{ at:0,pos:50 }, { at:duration,pos:50 }]]));
  const warnings = [], blocks = [];
  for (const section of session.sections) {
    if (['clip','gaps'].includes(section.motion)) {
      for (const p of session.placements.filter(p => p.section_id === section.id)) {
        const clip = byId.get(p.clip_id);
        const audioSync=isAudioSyncClip(clip),generated=audioSync?songMotion(session,section,p.start_ms,p.end_ms):null;
        if (!audioSync&&!clip.scripts?.L0) throw new Error(`${clip.name} has no L0 script. Choose song motion or another clip.`);
        for (const axis of AXES) {
          const input = !audioSync&&clip.scripts?.[axis]?.actions;
          const actions = audioSync&&axis==='L0'?generated:input?remapActions(input,p,section.strength):[{at:p.start_ms,pos:50},{at:p.end_ms,pos:50}];
          tracks[axis] = spliceActions(tracks[axis], actions, p.start_ms, p.end_ms, 'blend', session.blend_ms);
        }
        blocks.push({ start_ms:p.start_ms,end_ms:p.end_ms,kind:audioSync?'song':'clip',clip_id:clip.id,...(audioSync?{audio_sync:true}:{}) });
        if (!audioSync&&isDraftClip(clip)) warnings.push(`${clip.name}: unreviewed draft script`);
      }
    }
    if (section.motion === 'song' || section.motion === 'gaps') {
      const ranges = section.motion === 'song' ? [[section.start_ms,section.end_ms]] : (section.gaps || []);
      for (const [start,end] of ranges) {
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < section.start_ms || end > section.end_ms || end <= start) throw new Error('Marked motion gaps must stay inside their section.');
        tracks.L0 = spliceActions(tracks.L0,songMotion(session,section,start,end),start,end,'blend',session.blend_ms);
        blocks.push({start_ms:start,end_ms:end,kind:'song'});
      }
    }
    if (section.motion === 'hold') blocks.push({start_ms:section.start_ms,end_ms:section.end_ms,kind:'hold'});
  }
  for (const axis of AXES) {
    tracks[axis] = tracks[axis].filter(a => a.at >= 0 && a.at <= duration);
    validateActions(tracks[axis]);
  }
  return { schema:'funciv-playback/1', session_id:session.id, revision:session.revision, duration_ms:duration,
    song:clone(session.song), output:outputSettings(session), placements:clone(session.placements), sections:clone(session.sections),
    scripts:Object.fromEntries(AXES.map(axis => [axis,{version:'1.0',inverted:false,range:100,actions:tracks[axis],
      metadata:{title:session.name,creator:'FunCiv Player',chapters:session.sections.map(s=>({name:s.label,startTime:s.start_ms,endTime:s.end_ms}))}}])),
    warnings:[...new Set(warnings)], blocks };
}

export class History {
  constructor(){ this.past=[]; this.future=[]; }
  record(state){ this.past.push(clone(state)); if(this.past.length>40)this.past.shift(); this.future=[]; }
  undo(state){ if(!this.past.length)return state;this.future.push(clone(state));return this.past.pop(); }
  redo(state){ if(!this.future.length)return state;this.past.push(clone(state));return this.future.pop(); }
}
