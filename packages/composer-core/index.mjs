import { evaluate } from '../../vendor/motion-studio/curve.mjs';
import { spliceActions } from '../../vendor/motion-studio/timeline.mjs';
import { generateBeatSection } from '../../vendor/motion-studio/audio-patterns.mjs';

export const SCHEMA = 'funciv-session/1';
export const AXES = ['L0', 'L1', 'L2', 'R0', 'R1', 'R2'];
export const SUFFIX = { L0: '', L1: '.surge', L2: '.sway', R0: '.twist', R1: '.roll', R2: '.pitch' };
const finite = (n, label) => { if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number.`); return n; };
export const clone = value => structuredClone(value);
const validRating = value => Number.isInteger(value) && value >= 0 && value <= 5;
/** Ratings belong to a script variant. An explicit local override of zero means unrated. */
export const clipRating = clip => validRating(clip?.user_rating) ? clip.user_rating : validRating(clip?.quality) ? clip.quality : 0;

export function assertClipRatings(session, clips) {
  const minimum = session.min_rating ?? 0, byId = new Map(clips.map(c => [c.id, c]));
  for (const p of session.placements || []) {
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
    song: clone(song), seed: 1, blend_ms: 150, min_rating: 0, analysis: null, placements: [],
    sections: Array.from({ length: count }, (_, i) => ({ id: crypto.randomUUID(), label: `Section ${i + 1}`,
      start_ms: Math.round(duration * i / count), end_ms: Math.round(duration * (i + 1) / count),
      category: '*', motion: 'clip', strength: 100, locked: false, gaps: [] })) };
}

export function validateSession(session, clips = null) {
  if (session?.schema !== SCHEMA || !Array.isArray(session.sections) || !session.sections.length) throw new Error('Unsupported or empty session.');
  if (!session.song?.id || !(finite(session.song.duration_ms, 'Duration') > 0)) throw new Error('Song is missing.');
  const sectionIds = new Set(); let end = 0;
  for (const s of session.sections) {
    if (!s.id || sectionIds.has(s.id)) throw new Error('Section IDs must be unique.');
    sectionIds.add(s.id);
    if (![s.start_ms, s.end_ms].every(Number.isInteger) || s.start_ms !== end || s.end_ms <= s.start_ms) throw new Error('Sections must cover the song without gaps or overlaps.');
    if (!['clip', 'song', 'gaps', 'hold'].includes(s.motion)) throw new Error('Unknown motion policy.');
    if (!Number.isFinite(s.strength) || s.strength < 0 || s.strength > 100) throw new Error('Strength must be 0–100.');
    end = s.end_ms;
  }
  if (end !== Math.round(session.song.duration_ms)) throw new Error('Sections must end at the song duration.');
  if (!Number.isFinite(session.blend_ms) || session.blend_ms < 0 || session.blend_ms > 2000) throw new Error('Blend must be between 0 and 2000 ms.');
  if (session.bpm !== undefined && (!Number.isFinite(session.bpm) || session.bpm < 30 || session.bpm > 300)) throw new Error('BPM must be between 30 and 300.');
  if (!Number.isInteger(session.seed) || !Number.isInteger(session.revision) || session.revision < 0) throw new Error('Invalid seed or revision.');
  if (session.min_rating !== undefined && !validRating(session.min_rating)) throw new Error('Minimum rating must be an integer from 0 to 5.');
  const byId = clips && new Map(clips.map(c => [c.id, c]));
  const ids = new Set();
  for (const p of session.placements || []) {
    if (!p.id || ids.has(p.id)) throw new Error('Placement IDs must be unique.');
    ids.add(p.id);
    const s = session.sections.find(s => s.id === p.section_id);
    if (!s || ![p.start_ms, p.end_ms, p.source_in_ms, p.rate].every(Number.isFinite) || p.start_ms < s.start_ms || p.end_ms > s.end_ms || p.end_ms <= p.start_ms || p.source_in_ms < 0 || p.rate < .25 || p.rate > 4) throw new Error('A clip has invalid source or song bounds.');
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
  let previous = null, index = 0;
  for (const section of session.sections) {
    if (section.locked) {
      const existing = session.placements.filter(p => p.section_id === section.id);
      if (!existing.length) throw new Error(`Unlock ${section.label} before its first assembly.`);
      assertClipRatings({...session, placements:existing}, clips);
      placements.push(...clone(existing)); previous=existing.at(-1).clip_id; continue;
    }
    const pool = clips.filter(c => c.available !== false && c.duration_ms >= 100 && clipRating(c) >= (session.min_rating ?? 0) &&
      (section.category === '*' || (c.categories || []).includes(section.category)) &&
      (['song','hold'].includes(section.motion) || c.scripts?.L0 || c.script_ready)).sort((a,b) => a.id.localeCompare(b.id));
    if (!pool.length) throw new Error(`No usable clips for ${section.label}${session.min_rating ? ` at ${session.min_rating}★ or higher` : ''}. Check the minimum rating, draft filter and category; resolve videos${['clip','gaps'].includes(section.motion) ? ' with L0 scripts, or use Follow song' : ''}.`);
    let start = section.start_ms;
    while (start < section.end_ms) {
      const alternatives = pool.filter(c => c.id !== previous), choices = alternatives.length ? alternatives : pool;
      const clip = choices[Math.floor(rng() * choices.length)];
      const end = Math.min(section.end_ms, start + Math.floor(clip.duration_ms));
      placements.push({ id: `${section.id}-${index++}`, section_id: section.id, clip_id: clip.id,
        start_ms: start, end_ms: end, source_in_ms: 0, rate: 1 });
      previous = clip.id; start = end;
      if (placements.length > 5000) throw new Error('Session has too many cuts. Use longer clips.');
    }
  }
  result.placements = placements;
  delete result.asset_bindings; // A deliberate reassembly adopts the current catalog.
  validateSession(result, clips);
  return result;
}

export function validateCoverage(session) {
  let previous = 0;
  for (const p of [...session.placements].sort((a,b) => a.start_ms - b.start_ms)) {
    if (p.start_ms !== previous) throw new Error('Assemble every section before preparing playback.');
    previous = p.end_ms;
  }
  if (previous !== Math.round(session.song.duration_ms)) throw new Error('The video timeline does not cover the song. Assemble it first.');
}

export function compile(session, clips) {
  validateSession(session, clips); validateCoverage(session); assertClipRatings(session, clips);
  const duration = Math.round(session.song.duration_ms), byId = new Map(clips.map(c => [c.id,c]));
  const tracks = Object.fromEntries(AXES.map(axis => [axis, [{ at:0,pos:50 }, { at:duration,pos:50 }]]));
  const warnings = [], blocks = [];
  for (const section of session.sections) {
    if (['clip','gaps'].includes(section.motion)) {
      for (const p of session.placements.filter(p => p.section_id === section.id)) {
        const clip = byId.get(p.clip_id);
        if (!clip.scripts?.L0) throw new Error(`${clip.name} has no L0 script. Choose song motion or another clip.`);
        for (const axis of AXES) {
          const input = clip.scripts[axis]?.actions;
          const actions = input ? remapActions(input,p,section.strength) : [{at:p.start_ms,pos:50},{at:p.end_ms,pos:50}];
          tracks[axis] = spliceActions(tracks[axis], actions, p.start_ms, p.end_ms, 'blend', session.blend_ms);
        }
        blocks.push({ start_ms:p.start_ms,end_ms:p.end_ms,kind:'clip',clip_id:clip.id });
        if (clip.review_status === 'draft') warnings.push(`${clip.name}: draft script`);
      }
    }
    if (section.motion === 'song' || section.motion === 'gaps') {
      const ranges = section.motion === 'song' ? [[section.start_ms,section.end_ms]] : (section.gaps || []);
      for (const [start,end] of ranges) {
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < section.start_ms || end > section.end_ms || end <= start) throw new Error('Marked motion gaps must stay inside their section.');
        if (!session.analysis) throw new Error('Analyze the song before generating song motion.');
        const audio = { analysis: session.analysis, offset_ms:0 };
        const generated = generateBeatSection(audio,start,end,{ mode:'manual',shape:'Sine Wave',timing:'tempo',
          bpm: session.bpm || session.analysis.bpm || 120, amplitude:section.strength/2, center:50, followEnergy:true, seed:session.seed });
        tracks.L0 = spliceActions(tracks.L0,generated.actions,start,end,'blend',session.blend_ms);
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
    song:clone(session.song), placements:clone(session.placements), sections:clone(session.sections),
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
