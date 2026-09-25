const kinds=new Set(['none','fade','pop','slide_up','slide_down','slide_left','slide_right']);
const sizeOkay=s=>Array.isArray(s)&&s.length===2&&s.every(n=>Number.isInteger(n)&&n>0&&n<=16384);
const fpsOkay=n=>Number.isFinite(n)&&n>0&&n<=240;
const frameOkay=n=>Number.isSafeInteger(n)&&n>=0&&n<=240*86400;

export function validateBubbleLayers(layers,asset=()=>{}){
  if(!Array.isArray(layers)||layers.length>256)throw new Error('Invalid bubble layers.');
  for(const row of layers){
    if(!row||typeof row.image!=='string'||!row.image||!Number.isFinite(row.start_seconds)||row.start_seconds<0||row.start_seconds>86400||
      row.end_seconds!=null&&(!Number.isFinite(row.end_seconds)||row.end_seconds<=row.start_seconds||row.end_seconds>86400))throw new Error('Invalid bubble visibility interval.');
    asset(row.image);
    if(row.fps!==undefined){
      if(!fpsOkay(row.fps)||!frameOkay(row.start_frame)||!frameOkay(row.end_frame)||row.end_frame<=row.start_frame||
        Math.abs(row.start_seconds-row.start_frame/row.fps)>1e-6||row.end_seconds==null||Math.abs(row.end_seconds-row.end_frame/row.fps)>1e-6)throw new Error('Invalid bubble frame timing.');
    }
    if(row.size!==undefined&&!sizeOkay(row.size))throw new Error('Invalid bubble canvas size.');
    if(row.bounds!=null&&(!row.size||!Array.isArray(row.bounds)||row.bounds.length!==4||row.bounds.some(n=>!Number.isFinite(n)||n<0)||row.bounds[2]<=row.bounds[0]||row.bounds[3]<=row.bounds[1]||row.bounds[2]>row.size[0]||row.bounds[3]>row.size[1]))throw new Error('Invalid bubble bounds.');
    if(row.transition!==undefined){
      if(!row.transition||typeof row.transition!=='object'||Array.isArray(row.transition))throw new Error('Invalid bubble transitions.');
      for(const edge of ['enter','exit'])if(!kinds.has(row.transition[edge]??'none')||
        !Number.isInteger(row.transition[edge+'_frames']??0)||(row.transition[edge+'_frames']??0)<0||
        (row.transition[edge+'_frames']??0)>Math.round((row.fps||0)*5))throw new Error('Invalid bubble transition duration or effect.');
    }
  }
  return layers;
}

/** Saved editor timing wins; applied render layers also cover older FLF takes.
 * Undefined means legacy overlay. An empty array deliberately hides all bubbles. */
export function animatorBubbleLayers(render,timeline){
  let rows;
  if(timeline!=null){
    if(timeline.schema_version!==1||!fpsOkay(timeline.fps)||!frameOkay(timeline.frames)||timeline.frames<1||!sizeOkay(timeline.size)||!Array.isArray(timeline.tracks)||timeline.tracks.length>256)throw new Error('Invalid Animator bubble timeline.');
    const ids=new Set();
    rows=timeline.tracks.map(t=>{
      if(!t||typeof t.id!=='string'||ids.has(t.id)||typeof t.enabled!=='boolean'||!frameOkay(t.start_frame)||!frameOkay(t.end_frame)||t.end_frame>timeline.frames)throw new Error('Invalid Animator bubble track.');ids.add(t.id);
      return {image:t.image,start_seconds:t.start_frame/timeline.fps,end_seconds:t.end_frame/timeline.fps,start_frame:t.start_frame,end_frame:t.end_frame,fps:timeline.fps,size:timeline.size,transition:t.transition||{},enabled:t.enabled};
    });
    validateBubbleLayers(rows);
    rows=rows.filter(r=>r.enabled).map(({enabled,...r})=>r);
  }else if(Object.hasOwn(render,'bubble_layers')){
    if(!Array.isArray(render.bubble_layers))throw new Error('Invalid applied bubble layers.');
    rows=render.bubble_layers.map(r=>({image:r.image,start_seconds:r.start_seconds??0,end_seconds:r.end_seconds??null,
      ...Object.fromEntries(['fps','start_frame','end_frame','size','bounds','transition'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))}));
  }
  return rows===undefined?undefined:validateBubbleLayers(rows);
}

/** Mirrors H3 Animator's frame-based smoothstep transitions. The video frame,
 * not the extended motion clock, determines what lettering is visible. */
export function bubbleState(row,seconds,size=row.size||[1,1]){
  const frame=row.fps?Math.floor(seconds*row.fps+1e-4):null;
  const visible=frame===null?seconds>=row.start_seconds&&(row.end_seconds==null||seconds<row.end_seconds):frame>=row.start_frame&&frame<row.end_frame;
  const state={visible,opacity:visible?1:0,scale:1,x:0,y:0};
  if(!visible||frame===null)return state;
  const t=row.transition||{},limit=Math.max(0,Math.floor((row.end_frame-row.start_frame-1)/2));
  for(const [kind,frames,elapsed,direction] of [[t.enter,t.enter_frames,frame-row.start_frame,1],[t.exit,t.exit_frames,row.end_frame-1-frame,-1]]){
    const n=Math.min(frames||0,limit);if(!kind||kind==='none'||!n||elapsed>=n)continue;
    const p=Math.max(0,elapsed/n),ease=p*p*(3-2*p),distance=Math.min(...size)*.035*(1-ease)*direction;
    state.opacity*=ease;
    if(kind==='pop')state.scale*=.82+.18*ease;
    if(kind==='slide_up')state.y+=distance;if(kind==='slide_down')state.y-=distance;
    if(kind==='slide_left')state.x+=distance;if(kind==='slide_right')state.x-=distance;
  }
  return state;
}
