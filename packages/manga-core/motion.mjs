import { evaluate } from '../../vendor/motion-studio/curve.mjs';

export const AXES = ['L0','L1','L2','R0','R1','R2'];
export const DEFAULT_PRESENTATION = Object.freeze({mode:'none',extraSeconds:60,stillSeconds:10,advance:'manual',repeatAudio:false,volume:0.8,bubbles:true,ignoreBubbleTiming:false,autoplay:'page',readBefore:false,gain:1,edgeFades:false});
export function presentation(value={}) {
  const p={...DEFAULT_PRESENTATION,...value};
  if(typeof p.ignoreBubbleTiming!=='boolean')throw new Error('Invalid bubble timing preference.');
  if(!['none','pause','loop','extend'].includes(p.mode)||!['manual','budget'].includes(p.advance)||!['manual','page','continuous'].includes(p.autoplay))throw new Error('Invalid reading mode.');
  for(const [key,min,max] of [['extraSeconds',1,600],['stillSeconds',0,600],['volume',0,1],['gain',0,2]])if(!Number.isFinite(p[key])||p[key]<min||p[key]>max)throw new Error(`Invalid ${key}.`);
  return p;
}
export function validateScript(script,durationMs) {
  if(!Array.isArray(script?.actions)||script.actions.length<2||script.actions.length>500000)throw new Error('Motion needs between 2 and 500,000 actions.');
  let previous=-1;
  for(const a of script.actions){
    if(!Number.isFinite(a.at)||!Number.isFinite(a.pos)||a.at<0||a.at<=previous||a.pos<0||a.pos>100||a.at>durationMs+50)throw new Error('Motion has invalid positions, timestamps, or a different video duration.');
    previous=a.at;
  }
  return {...script,inverted:false,actions:script.actions.map(a=>({at:a.at,pos:script.inverted?100-a.pos:a.pos}))};
}
export function sample(actions,at){return actions?.length?evaluate(actions,at):50;}
export function sliceActions(actions,start,end){
  return [{at:0,pos:sample(actions,start)},...actions.filter(a=>a.at>start&&a.at<end).map(a=>({at:a.at-start,pos:a.pos})),{at:end-start,pos:sample(actions,end)}];
}
/** A repeated phrase preserves action spacing and axis phase. Auto selection
 * requires two similar complete trough-to-trough cycles, not just a BPM guess. */
export function findPhrase(scripts,durationMs,range) {
  const actions=scripts.L0?.actions;
  if(!actions?.length)throw new Error('This panel has no primary motion script.');
  if(range){
    const [start,end]=range;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>durationMs||end-start<200)throw new Error('Choose a motion phrase of at least 0.2 seconds inside this video.');
    if(Object.values(scripts).some(s=>Math.abs(sample(s.actions,start)-sample(s.actions,end))>10))throw new Error('Choose phrase boundaries at a similar motion position on every axis.');
    return {start,end,duration:end-start,manual:true};
  }
  const troughs=[],turns=actions.filter((a,i)=>!i||a.pos!==actions[i-1].pos);
  for(let i=0;i<turns.length;i++){
    const a=turns[i],left=turns[i-1],right=turns[i+1];
    if((!left||a.pos<left.pos)&&right&&a.pos<right.pos)troughs.push(a.at);
    else if(left&&a.pos<left.pos&&!right)troughs.push(a.at);
  }
  for(let i=troughs.length-1;i>=2;i--){
    const [a,b,c]=troughs.slice(i-2,i+1),d1=b-a,d2=c-b;
    if(d1<200||d2<200||Math.abs(d1-d2)/Math.max(d1,d2)>.25)continue;
    const values=actions.filter(p=>p.at>=a&&p.at<=c).map(p=>p.pos);
    if(values.reduce((m,v)=>Math.max(m,v),0)-values.reduce((m,v)=>Math.min(m,v),100)<8)continue;
    let difference=0;
    for(let n=0;n<=16;n++)difference+=Math.abs(sample(actions,a+d1*n/16)-sample(actions,b+d2*n/16));
    if(difference/17>12)continue;
    if(Object.values(scripts).some(s=>Math.abs(sample(s.actions,a)-sample(s.actions,c))>10))continue;
    return {start:a,end:c,duration:c-a,manual:false};
  }
  throw new Error('No stable repeating motion was found. Choose a phrase range or use Pause to read.');
}
function append(target,actions,offset){
  for(const a of actions){const at=Math.round(a.at+offset),last=target.at(-1);if(last?.at===at)last.pos=a.pos;else target.push({at,pos:a.pos});}
}
/** Finite page runs make cloud upload duration explicit. No motion fills static
 * panels. Repeated motion is derived data and never rewrites approved sidecars. */
export function compileRun(items,settings={}) {
  const segments=[],tracks=Object.fromEntries(AXES.map(a=>[a,[]]));let cursor=0;
  for(const item of items){
    const p=presentation({...settings,...item.presentation}),duration=item.durationMs||0;
    const hasVideo=!!item.media&&duration>0;
    const scripts=Object.fromEntries(Object.entries(hasVideo?item.scripts||{}:{}).map(([a,s])=>[a,validateScript(s,duration)]));
    const groupStart=cursor;let iteration=0;
    const add=(kind,length,sourceStart=0,phrase=null)=>{
      const segment={id:`${item.id}:${iteration}`,panelId:item.id,pageStill:!!item.pageStill,kind,start:cursor,end:cursor+length,duration:length,videoDuration:duration,iteration:iteration++,sourceStart,media:item.media||null,baked:item.baked||null,overlay:item.overlay||null,poster:item.poster||null,static:item.static||null,staticClean:item.staticClean||null,settings:p,motion:!!scripts.L0,phrase,groupStart};
      if(item.bubbleLayers!==undefined)segment.bubbleLayers=item.bubbleLayers;
      segment.videoWidth=item.width;segment.videoHeight=item.height;
      segments.push(segment);
      for(const axis of AXES){
        if(!scripts[axis]){const last=tracks[axis].at(-1);if(last)append(tracks[axis],[{at:0,pos:last.pos},{at:length,pos:last.pos}],cursor);continue;}
        const input=sliceActions(scripts[axis].actions,sourceStart,sourceStart+length);
        const last=tracks[axis].at(-1);
        // Smooth the seam inside the new segment without altering its length.
        if(last&&cursor-last.at<2&&Math.abs(last.pos-input[0].pos)>1){
          const blend=Math.min(150,length/8);input[0].pos=last.pos;
          for(let j=1;j<input.length&&input[j].at<blend;j++)input[j].pos=last.pos+(input[j].pos-last.pos)*(input[j].at/blend);
          if(!input.some(a=>a.at===blend))input.push({at:blend,pos:sample(scripts[axis].actions,sourceStart+blend)});
          input.sort((a,b)=>a.at-b.at);
        }
        append(tracks[axis],input,cursor);
      }
      cursor+=length;return segment;
    };
    if(!hasVideo){add('still',Math.max(1,Math.round(p.stillSeconds*1000))).groupEnd=true;continue;}
    add('video',duration);
    if(p.mode==='loop'){
      const count=Math.min(300,Math.ceil(p.extraSeconds*1000/duration));
      for(let i=0;i<count;i++)add('loop',duration);
    }else if(p.mode==='extend'&&scripts.L0){
      const phrase=findPhrase(scripts,duration,p.phraseRange);
      const count=Math.min(600,Math.ceil(p.extraSeconds*1000/phrase.duration));
      for(let i=0;i<count;i++)add('extension',phrase.duration,phrase.start,phrase);
    }
    const last=segments.at(-1);last.groupEnd=true;
  }
  for(const s of segments){s.nextPanel=segments.find(x=>x.start>=s.end&&x.panelId!==s.panelId)?.start??cursor;}
  // Unscripted intervals hold the preceding axis position and also gate off the
  // device clock. They cannot overwrite the next segment's bounded entry blend.
  const scripts=Object.fromEntries(Object.entries(tracks).map(([axis,actions])=>[axis,{version:'1.0',inverted:false,range:100,actions:actions.filter((a,i)=>i===actions.length-1||a.at!==actions[i+1].at)}]));
  return {duration_ms:cursor,segments,scripts,session_id:items.map(i=>i.id).join('|'),song:{name:settings.title||'Manga page'}};
}
