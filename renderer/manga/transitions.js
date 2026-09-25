// Freeze pixels, never duplicate a live decoder or overlap audio. The outgoing
// picture remains visible through a cache miss and fades only after readiness.
export class MangaTransitions {
  constructor(root){this.root=root;}
  begin(){
    if(this.canvas)return;
    const surface=this.root.querySelector('.mg-surface'),reader=this.root.querySelector('.mg-reader');
    const bounds=surface.getBoundingClientRect(),parent=reader.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    const canvas=document.createElement('canvas'),scale=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(bounds.width*scale);canvas.height=Math.round(bounds.height*scale);
    canvas.className='mg-transition';canvas.setAttribute('aria-hidden','true');
    Object.assign(canvas.style,{left:`${bounds.left-parent.left}px`,top:`${bounds.top-parent.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});
    const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='#0e1117';ctx.fillRect(0,0,bounds.width,bounds.height);
    for(const el of surface.querySelectorAll('.mg-paper,img,video,canvas.mg-bubbles')){
      if(el.closest('[hidden]'))continue;
      const r=el.getBoundingClientRect();if(!r.width||!r.height||r.bottom<bounds.top||r.top>bounds.bottom)continue;
      let x=r.left-bounds.left,y=r.top-bounds.top,w=r.width,h=r.height;
      if(el.classList.contains('mg-paper')){ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);continue;}
      const iw=el.videoWidth||el.naturalWidth||el.width,ih=el.videoHeight||el.naturalHeight||el.height;if(!iw||!ih)continue;
      const fit=getComputedStyle(el).objectFit;
      if(fit==='contain'){const k=Math.min(w/iw,h/ih);x+=(w-iw*k)/2;y+=(h-ih*k)/2;w=iw*k;h=ih*k;}
      try{ctx.drawImage(el,x,y,w,h);}catch{/* Keep the remaining loaded artwork. */}
    }
    reader.append(canvas);this.canvas=canvas;
  }
  ready(){
    const canvas=this.canvas;if(!canvas)return;
    this.canvas=null;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){canvas.remove();return;}
    this.fading?.remove();this.fading=canvas;
    canvas.animate([{opacity:1},{opacity:0}],{duration:180,easing:'ease-out'}).finished.catch(()=>{}).finally(()=>{canvas.remove();if(this.fading===canvas)this.fading=null;});
  }
  cancel(){this.canvas?.remove();this.fading?.remove();this.canvas=this.fading=null;}
}
