const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

/** Local texture changes are suggestions, not verse/chorus classifications. */
export function audioChangeMarkers(analysis){
  const features=analysis?.features;if(!features?.energy?.length)return [];
  const count=features.energy.length,step=analysis.duration_ms/count,window=Math.max(1,Math.round(1000/step));
  const tracks=['energy','brightness','bass'].map(key=>features[key]).filter(values=>values?.length===count);
  const prefix=tracks.map(values=>{const sum=[0];for(const value of values)sum.push(sum.at(-1)+(Number.isFinite(value)?value:0));return sum;});
  const candidates=[];
  for(let i=window;i<count-window;i++){
    const score=prefix.reduce((sum,p)=>sum+Math.abs((p[i+window]-p[i])-(p[i]-p[i-window]))/window,0)/prefix.length;
    if(score>=.12)candidates.push({at:Math.round(i*step),score});
  }
  const chosen=[];for(const c of candidates.sort((a,b)=>b.score-a.score||a.at-b.at))if(chosen.every(p=>Math.abs(p.at-c.at)>=2000))chosen.push(c);
  return chosen.sort((a,b)=>a.at-b.at);
}

export function snapToAudio(at,analysis,tolerance=120){
  let best=Math.round(at),distance=tolerance+1;
  for(const p of [...(analysis?.beats||[]),...(analysis?.onsets||[])])if(Number.isFinite(p.at)&&Math.abs(p.at-at)<distance){best=Math.round(p.at);distance=Math.abs(p.at-at);}
  return best;
}

export function suggestRegionCuts(analysis,section,beatsPerRegion=4){
  if(!analysis)throw new Error('Analyze the song before suggesting clip regions.');
  if(![2,4,8,16].includes(beatsPerRegion))throw new Error('Choose 2, 4, 8 or 16 beats per region.');
  const grid=(analysis.beats||[]).filter(p=>Number.isFinite(p.at)&&p.at>=section.start_ms&&p.at<section.end_ms).map(p=>p.at).sort((a,b)=>a-b);
  let candidates=[];
  if(grid.length>=2){for(let i=beatsPerRegion;i<grid.length;i+=beatsPerRegion)candidates.push(Math.round(grid[i]));}
  else{
    const bpm=analysis.bpm;if(!(bpm>=30&&bpm<=300))throw new Error('No reliable beat grid or tempo was found. Mark cuts manually on the waveform.');
    const step=60000/bpm*beatsPerRegion;
    for(let at=section.start_ms+step;at<section.end_ms;at+=step)candidates.push(snapToAudio(at,analysis));
  }
  // Prefer a nearby change in energy/timbre to the regular beat-group boundary.
  const changes=audioChangeMarkers(analysis).filter(p=>p.at>section.start_ms&&p.at<section.end_ms);
  for(const change of changes){const at=snapToAudio(change.at,analysis,200),near=candidates.findIndex(t=>Math.abs(t-at)<=500);if(near>=0)candidates[near]=at;else candidates.push(at);}
  const minimum=250,cuts=[];
  for(const at of [...new Set(candidates)].sort((a,b)=>a-b))if(at-(cuts.at(-1)??section.start_ms)>=minimum&&section.end_ms-at>=minimum)cuts.push(clamp(at,section.start_ms+minimum,section.end_ms-minimum));
  if(cuts.length>4999)throw new Error('Too many suggested regions. Increase the beats per region.');
  return cuts;
}
