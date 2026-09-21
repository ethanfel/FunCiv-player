import { evaluate } from '../../vendor/motion-studio/curve.mjs';

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export const MAX_ZOOM=256;
export function zoomGeometry(width,oldZoom,newZoom,scrollLeft,anchor){
  const zoom=clamp(newZoom,1,MAX_ZOOM),contentWidth=width*zoom;
  return {zoom,contentWidth,scrollLeft:clamp((scrollLeft+anchor)/oldZoom*zoom-anchor,0,contentWidth-width)};
}
export function rulerInterval(millisecondsPerPixel){
  const desired=millisecondsPerPixel*95;
  return [10,20,50,100,200,500,1000,2000,5000,10000,15000,30000,60000,120000,300000,600000,1800000,3600000].find(n=>n>=desired)||3600000;
}
const stamp=(ms,step)=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(step<1000?step<100?2:1:0).padStart(step<1000?step<100?5:4:2,'0')}`;
export const TIMELINE_TOOLS=`<div class="fc-timeline-tools"><strong>Timeline</strong><button data-action="zoom-out" aria-label="Zoom out">−</button><label>Zoom<select data-field="timeline-zoom" aria-label="Timeline zoom">${[1,2,4,8,16,32,64,128,256].map(n=>`<option value="${n}">${n}×</option>`).join('')}<option value="custom" disabled>Custom</option></select></label><input data-field="zoom-slider" type="range" min="0" max="8" step="0.05" value="0" aria-label="Continuous timeline zoom"><button data-action="zoom-in" aria-label="Zoom in">＋</button><button data-action="zoom-fit">Fit song</button><button data-action="zoom-section">Fit section</button><label class="fc-check"><input data-field="follow-playhead" type="checkbox" checked> Follow</label><small>Ctrl/⌘ + wheel: zoom · Shift + wheel or middle drag: pan</small></div>`;

/** Tracks use song coordinates; canvases paint only the visible window, even at 256×. */
export class TimelineViewport {
  constructor(view){
    this.view=view;this.root=view.root;this.viewport=this.root.querySelector('.fc-timeline-viewport');this.track=this.root.querySelector('.fc-timeline');this.zoom=1;
    this.viewport.addEventListener('scroll',()=>this.draw(),{passive:true});
    this.viewport.addEventListener('wheel',event=>{
      if(!view.session||view.regionEditor?.drag)return;
      const unit=event.deltaMode===1?16:event.deltaMode===2?this.viewport.clientWidth:1;
      if(event.ctrlKey||event.metaKey){event.preventDefault();event.stopPropagation();this.setZoom(this.zoom*Math.exp(-event.deltaY*unit*.004),event.clientX-this.viewport.getBoundingClientRect().left);}
      else if(event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)){event.preventDefault();this.viewport.scrollLeft+=(event.deltaX||event.deltaY)*unit;}
    },{passive:false});
    this.viewport.addEventListener('pointerdown',event=>{
      if(!view.session||event.button!==1&&(event.button!==0||!event.target.matches('.fc-wave,.fc-motion,.fc-ruler')))return;
      event.preventDefault();this.drag={id:event.pointerId,x:event.clientX,scroll:this.viewport.scrollLeft,pan:event.button===1};this.viewport.setPointerCapture(event.pointerId);
      this.viewport.classList.toggle('fc-panning',this.drag.pan);if(!this.drag.pan)view.setPosition(this.timeAt(event.clientX));
    });
    this.viewport.addEventListener('pointermove',event=>{
      if(this.drag?.id!==event.pointerId)return;
      if(this.drag.pan)this.viewport.scrollLeft=this.drag.scroll+this.drag.x-event.clientX;
      else view.setPosition(this.timeAt(event.clientX));
    });
    for(const name of ['pointerup','pointercancel'])this.viewport.addEventListener(name,()=>this.finishDrag());
  }
  finishDrag(){if(this.drag&&this.viewport.hasPointerCapture(this.drag.id))this.viewport.releasePointerCapture(this.drag.id);this.drag=null;this.viewport.classList.remove('fc-panning');}
  timeAt(clientX){const width=this.viewport.clientWidth||1;return clamp((this.viewport.scrollLeft+clientX-this.viewport.getBoundingClientRect().left-this.viewport.clientLeft)/(width*this.zoom)*(this.view.session?.song.duration_ms||1),0,(this.view.session?.song.duration_ms||1)-1);}
  setZoom(zoom,anchor){
    if(!this.view.session)return;
    const width=this.viewport.clientWidth;if(!width)return;
    const playhead=(this.view.position||0)/this.view.session.song.duration_ms*width*this.zoom-this.viewport.scrollLeft;
    const next=zoomGeometry(width,this.zoom,zoom,this.viewport.scrollLeft,anchor??(playhead>=0&&playhead<=width?playhead:width/2));
    this.zoom=next.zoom;this.track.style.width=`${next.contentWidth}px`;this.viewport.scrollLeft=next.scrollLeft;
    const select=this.root.querySelector('[data-field=timeline-zoom]'),preset=[...select.options].find(o=>Number(o.value)===this.zoom);
    select.value=preset?preset.value:'custom';select.querySelector('[value=custom]').textContent=`${this.zoom.toFixed(1)}×`;
    this.root.querySelector('[data-field=zoom-slider]').value=Math.log2(this.zoom);this.draw();
  }
  reset(){this.zoom=1;this.viewport.scrollLeft=0;this.setZoom(1,0);}
  action(action){
    if(!['zoom-in','zoom-out','zoom-fit','zoom-section'].includes(action))return false;
    if(!this.view.session)throw new Error('Load a song first.');
    if(action==='zoom-fit'){this.setZoom(1,0);this.viewport.scrollLeft=0;}
    else if(action==='zoom-section'){
      const s=this.view.session.sections[this.view.selected],duration=this.view.session.song.duration_ms;
      this.setZoom(duration/((s.end_ms-s.start_ms)*1.12),this.viewport.clientWidth/2);
      this.viewport.scrollLeft=(s.start_ms+s.end_ms)/2/duration*this.viewport.clientWidth*this.zoom-this.viewport.clientWidth/2;
    }else this.setZoom(this.zoom*(action==='zoom-in'?1.5:1/1.5));
    this.draw();return true;
  }
  follow(time){
    if(!this.view.player.intent||this.drag||!this.root.querySelector('[data-field=follow-playhead]').checked)return;
    const width=this.viewport.clientWidth,x=time/(this.view.session?.song.duration_ms||1)*width*this.zoom;
    if(x<this.viewport.scrollLeft||x>this.viewport.scrollLeft+width-20)this.viewport.scrollLeft=Math.max(0,x-width*.15);
  }
  draw(){
    const s=this.view.session,width=this.viewport.clientWidth;if(!s||!width)return;
    this.track.style.width=`${width*this.zoom}px`;
    const total=width*this.zoom,start=this.viewport.scrollLeft/total*s.song.duration_ms,perPixel=s.song.duration_ms/total,dpr=Math.min(window.devicePixelRatio||1,2);
    const step=rulerInterval(perPixel),ticks=[];
    for(let at=Math.ceil(start/step)*step;at<=Math.min(s.song.duration_ms,start+width*perPixel);at+=step)ticks.push({at,x:(at-start)/perPixel});
    for(const selector of ['.fc-ruler','.fc-wave','.fc-motion']){
      const canvas=this.root.querySelector(selector),height=selector==='.fc-ruler'?28:64;
      canvas.style.width=`${width}px`;canvas.width=Math.round(width*dpr);canvas.height=height*dpr;
      const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
      if(selector==='.fc-ruler'){
        ctx.font='10px system-ui';ctx.fillStyle='#aab8ce';ctx.strokeStyle='#40516a';ctx.beginPath();
        for(const tick of ticks){ctx.moveTo(tick.x,19);ctx.lineTo(tick.x,28);ctx.fillText(stamp(tick.at,step),tick.x+4,13);}ctx.stroke();continue;
      }
      ctx.strokeStyle='#233249';ctx.beginPath();for(const tick of ticks){ctx.moveTo(tick.x,0);ctx.lineTo(tick.x,height);}ctx.stroke();
      ctx.strokeStyle=selector==='.fc-wave'?'#7dd3fc':'#c4b5fd';ctx.lineWidth=1.2;ctx.beginPath();
      const values=selector==='.fc-wave'?s.analysis?.waveform:this.view.prepared?.snapshot.scripts.L0.actions;
      if(values?.length)for(let x=0;x<width;x++){
        const at=start+x*perPixel;
        if(selector==='.fc-wave'){
          const first=Math.floor(at/s.song.duration_ms*values.length),last=Math.min(values.length,Math.max(first+1,Math.ceil((at+perPixel)/s.song.duration_ms*values.length)));
          let peak=0;for(let i=first;i<last;i++)peak=Math.max(peak,values[i]||0);
          ctx.moveTo(x,32-peak*28);ctx.lineTo(x,32+peak*28);
        }else{const y=58-evaluate(values,at)*.52;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
      }else{ctx.moveTo(0,32);ctx.lineTo(width,32);}ctx.stroke();
    }
  }
}
