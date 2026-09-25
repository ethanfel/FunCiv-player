import {bubbleState} from '../../packages/manga-core/bubbles.mjs';

/** Composite overlays on the video's canvas so zoom, inline cropping and page
 * transitions preserve bubble positions and their individual transform origins. */
export class MangaBubbles {
  constructor(canvas){this.canvas=canvas;this.bounds=new WeakMap();}
  alphaBounds(image){
    if(this.bounds.has(image))return this.bounds.get(image);
    const canvas=this.canvas.ownerDocument.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);let l=canvas.width,t=canvas.height,r=0,b=0;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}
    const bounds=r>l?[l,t,r,b]:null;this.bounds.set(image,bounds);canvas.width=canvas.height=1;return bounds;
  }
  draw(segment,seconds,enabled,images=new Map(),{ignoreTiming=false}={}){
    const canvas=this.canvas;
    if(!enabled||!segment||segment.kind==='still'){canvas.hidden=true;this.key=null;return;}
    const layers=segment.bubbleLayers??(segment.overlay?[{image:segment.overlay,start_seconds:0,end_seconds:null}]:[]);
    const visible=layers.map(row=>{const image=images.get(row.image),size=row.size||[image?.naturalWidth||1,image?.naturalHeight||1];return {row,image,size,state:ignoreTiming?{visible:true,opacity:1,scale:1,x:0,y:0}:bubbleState(row,seconds,size)};}).filter(r=>r.image&&r.state.visible&&r.state.opacity>0);
    canvas.hidden=!visible.length;if(!visible.length){this.key=null;return;}
    const width=segment.videoWidth||visible[0].size[0],height=segment.videoHeight||visible[0].size[1];
    const key=JSON.stringify([width,height,visible.map(r=>[r.row.image,r.size,r.row.bounds,r.state])]);
    if(key===this.key&&images===this.images)return;this.key=key;this.images=images;
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);
    for(const {row,image,size,state} of visible){
      let bounds=row.bounds;
      if(!bounds&&state.scale!==1){const found=this.alphaBounds(image);if(found)bounds=found.map((n,i)=>n*size[i%2]/(i%2?image.naturalHeight:image.naturalWidth));}
      const center=bounds?[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2]:[size[0]/2,size[1]/2];
      ctx.save();ctx.scale(width/size[0],height/size[1]);ctx.globalAlpha=state.opacity;
      ctx.translate(center[0]+state.x,center[1]+state.y);ctx.scale(state.scale,state.scale);ctx.translate(-center[0],-center[1]);
      ctx.drawImage(image,0,0,...size);ctx.restore();
    }
  }
}
