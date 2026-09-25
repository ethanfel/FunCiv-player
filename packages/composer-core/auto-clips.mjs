export const DEFAULT_AUTO_CLIPS = Object.freeze({min_ms:4000,max_ms:12000});

export function validateAutoClips(policy) {
  if (policy === undefined) return; // Older recipes retain their stored layout.
  if (!policy || !Number.isInteger(policy.min_ms) || !Number.isInteger(policy.max_ms) ||
    policy.min_ms < 100 || policy.max_ms > 120000 || policy.max_ms < policy.min_ms)
    throw new Error('Automatic clip lengths must be between 0.1 and 120 seconds, with minimum ≤ maximum.');
}
export function checkAutoSection(section, policy) {
  if (!policy) return;
  if (section.end_ms - section.start_ms < 2 * policy.min_ms) {
    const error = new Error(`${section.label} is too short for two clips of at least ${policy.min_ms/1000} s. Extend or merge the section, lower the automatic minimum, or place its cuts manually.`);
    error.code = 'CLIP_PACING'; throw error;
  }
}

// The search chooses sources and coverage. Rebalance a short final remainder
// across the preceding clips, preserving order and every section boundary.
export function balanceAutoClips(placements, sections, policy) {
  if (!policy) return;
  for (const section of sections.filter(s => !s.locked && !s.planned_regions)) {
    const rows = placements.filter(p => p.section_id === section.id).sort((a,b) => a.start_ms-b.start_ms);
    if (rows.length < 2) throw new Error(`${section.label} needs at least two different source videos.`);
    const spans = rows.map(p => p.end_ms-p.start_ms);
    let needed = Math.max(0, policy.min_ms-spans.at(-1));
    spans[spans.length-1] += needed;
    for (let i=spans.length-2;i>=0 && needed;i--) {
      const transfer = Math.min(needed, spans[i]-policy.min_ms);
      spans[i]-=transfer;needed-=transfer;
    }
    if (needed) throw new Error(`${section.label} cannot fit these sources within the automatic clip length range.`);
    let start=section.start_ms;
    rows.forEach((p,i)=>{p.start_ms=start;p.end_ms=start+=spans[i];});
  }
}
