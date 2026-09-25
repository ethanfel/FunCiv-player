const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');
const {createReadStream}=require('node:fs');
const {MangaRunCache}=require('./manga-run-cache.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const exists=file=>fs.stat(file).then(s=>s.isFile()).catch(()=>false);
async function json(file,optional=false){try{const s=await fs.stat(file);if(s.size>16*1024*1024)throw new Error('Metadata file is too large.');return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}}
async function inside(root,relative){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw new Error('Asset path leaves its book.');
  const target=await fs.realpath(path.resolve(root,relative));const rel=path.relative(root,target);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Asset path leaves its book.');return target;
}
async function hashFile(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}}
class MangaService {
  constructor(root,{ffprobe='ffprobe',ffmpeg='ffmpeg'}={}){this.root=root;this.ffprobe=ffprobe;this.ffmpeg=ffmpeg;this.assets=new Map();this.books=new Map();this.watches=new Map();this.jobs=new Map();this.writeQueue=Promise.resolve();this.runCache=new MangaRunCache();}
  async init(){await fs.mkdir(this.root,{recursive:true});this.state=await json(path.join(this.root,'library.json'),true)||{sources:[],readers:{}};return this;}
  save(){const value=structuredClone(this.state);this.writeQueue=this.writeQueue.catch(()=>{}).then(()=>atomic(path.join(this.root,'library.json'),value));return this.writeQueue;}
  list(){return this.state.sources.map(({id,title,source,kind,opened})=>({id,key:`${kind}:${id}`,title,source,kind,opened}));}
  async command(binary,args,signal,captureError=false){return new Promise((resolve,reject)=>{const child=spawn(binary,['-nostdin',...args].filter(v=>binary===this.ffmpeg||v!=='-nostdin'),{signal,windowsHide:true});let out='',err='';child.stdout.on('data',v=>{out+=v;if(out.length>16*1024*1024)child.kill();});child.stderr.on('data',v=>err=(err+v).slice(-8000));child.on('error',reject);child.on('close',code=>code===0?resolve(captureError?err:out):reject(new Error(err||`${binary} failed (${code}).`)));});}
  async probe(file){const j=JSON.parse(await this.command(this.ffprobe,['-v','error','-show_streams','-show_format','-of','json',file]));const v=j.streams.find(s=>s.codec_type==='video');if(!v)throw new Error('No video track.');return {durationMs:Math.round(Number(v.duration||j.format.duration)*1000),width:v.width,height:v.height,audio:j.streams.some(s=>s.codec_type==='audio')};}
  async asset(root,relative,optional=false){
    try{const file=await inside(root,relative),stat=await fs.stat(file);if(!stat.isFile())throw new Error('Expected an asset file.');const id=digest(`${file}|${stat.size}|${stat.mtimeMs}`);this.assets.set(id,{id,file,size:stat.size,mtime:stat.mtimeMs,root});return id;}
    catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
  }
  url(id){return id?`manga-media://asset/${id}`:null;}
  async bubbleLayers(root,folder,takeDir,render,take,observe,issues){
    const {animatorBubbleLayers}=await import('../packages/manga-core/bubbles.mjs');
    const file=path.join(takeDir,'bubble_timeline.json');await observe(file);
    const load=async(rows,base)=>{
      if(rows===undefined)return;
      if(!take.clean)throw new Error('Timed bubbles need the clean video.');
      const layers=[];
      for(const row of rows){const image=await this.asset(root,path.relative(root,path.resolve(base,row.image)));await observe(this.assets.get(image).file);layers.push({...row,image});}
      take.bubbleLayers=layers;take.overlay=null;
    };
    try{
      const timeline=await json(file,true);
      if(timeline){await load(animatorBubbleLayers(render,timeline),takeDir);take.bubbleTimingSource='saved';return;}
    }catch(e){issues.push(`${render.panel_id} ${take.id}: saved bubble timing unavailable (${e.message}); using applied bubbles.`);take.overlay=null;}
    try{await load(animatorBubbleLayers(render),folder);if(take.bubbleLayers!==undefined)take.bubbleTimingSource='applied';}
    catch(e){issues.push(`${render.panel_id} ${take.id}: bubble layers unavailable (${e.message}); using the bubbles-on video.`);take.overlay=null;}
  }
  async open(source,signal){
    signal?.throwIfAborted();const root=await fs.realpath(source),watch=new Map(),observe=async file=>watch.set(file,await fs.stat(file).then(s=>`${s.size}:${s.mtimeMs}`).catch(()=>null));await observe(path.join(root,'project.json'));await observe(path.join(root,'index.json'));await observe(path.join(root,'catalogue.json'));const project=await json(path.join(root,'project.json'));
    if(project.schema_version!==1||!Array.isArray(project.pages)||project.pages.length>20000)throw new Error('Unsupported H3 project.');
    const fingerprint=digest(project.pages.every(p=>/^[a-f0-9]{64}$/.test(p.source_sha256))?JSON.stringify(project.pages.map(p=>[p.page_id,p.source_sha256])):root);
    let record=this.state.sources.find(s=>s.source===root&&s.kind==='h3')||this.state.sources.find(s=>s.fingerprint===fingerprint&&s.kind==='h3');
    record=record?{...record}:{id:randomUUID(),kind:'h3'};
    Object.assign(record,{source:root,fingerprint,title:path.basename(root).replace(/_project$/,'').replaceAll('_',' '),opened:Date.now()});
    const book={schema:'funciv-manga/1',id:record.id,revision:randomUUID(),title:record.title,direction:project.reading_direction||'ltr',pages:[],issues:[],kind:'h3'};
    const {takeVariant,applyH3Sequence}=await import('../packages/manga-core/sequence.mjs'),folders=new Map();
    const sequenceFile=path.join(root,'flf_sequence.json');await observe(sequenceFile);let sequence;
    try{sequence=await json(sequenceFile,true);}catch(e){sequence={};book.issues.push(`Cannot read joined-panel sequence: ${e.message}`);}
    for(const entry of project.pages){signal?.throwIfAborted();await observe(path.join(root,'pages',entry.page_id,'current.json'));
      const page={id:entry.page_id,width:entry.width,height:entry.height,panels:[],label:`Page ${book.pages.length+1}`};book.pages.push(page);
      try{page.image=await this.asset(root,entry.image);}catch(e){book.issues.push(`${page.label}: ${e.message}`);}
      try{
        const current=await json(await inside(root,`pages/${entry.page_id}/current.json`));
        const layoutFile=await inside(root,current.layout);await observe(layoutFile);const layout=await json(layoutFile);page.revision=path.basename(path.dirname(layoutFile));
        for(const ref of layout.panels||[]){
          try{const folder=await inside(root,ref.folder);await observe(path.join(folder,'main_take.json'));await observe(path.join(folder,'takes'));const meta=await json(path.join(folder,'panel.json'));
            const panel={id:`${entry.page_id}/${page.revision}/${meta.panel_id}`,sourceId:meta.panel_id,bbox:meta.bbox,polygon:meta.polygon,static:await this.asset(root,path.relative(root,path.join(folder,meta.reference||'reference.png')),true),clean:await this.asset(root,path.relative(root,path.join(folder,'clean_reference.png')),true),takes:[],selected:null};
            if(!Array.isArray(panel.bbox)||panel.bbox.length!==4||panel.bbox.some(n=>!Number.isFinite(n)||n<0||n>1)||panel.bbox[2]<=panel.bbox[0]||panel.bbox[3]<=panel.bbox[1])throw new Error('Invalid panel bounds.');
            if(panel.polygon&&(!Array.isArray(panel.polygon)||panel.polygon.length<3||panel.polygon.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1))))throw new Error('Invalid panel polygon.');page.panels.push(panel);folders.set(path.relative(root,folder).split(path.sep).join('/'),panel);
            const takes=await fs.readdir(path.join(folder,'takes'),{withFileTypes:true}).catch(()=>[]);
            for(const dir of takes.filter(d=>d.isDirectory()&&/^take_\d+$/.test(d.name)).sort((a,b)=>Number(b.name.slice(5))-Number(a.name.slice(5)))){
              try{const takeDir=path.join(folder,'takes',dir.name);await observe(path.join(takeDir,'render.json'));if(await exists(path.join(takeDir,'error.json')))continue;
                const render=await json(path.join(takeDir,'render.json'),true);if(!render||render.panel_id!==meta.panel_id)continue;
                const rel=p=>path.relative(root,path.join(folder,p));
                const take={id:dir.name,flfVariant:takeVariant(render),clean:render.variants?.bubbles_off?await this.asset(root,rel(render.variants.bubbles_off),true):null,baked:await this.asset(root,rel(render.variants?.bubbles_on||render.video),true),overlay:render.bubble_layer?await this.asset(root,rel(render.bubble_layer),true):null,poster:render.clean_reference?await this.asset(root,rel(render.clean_reference),true):null,transform:render.transform,scripts:{}};
                await this.bubbleLayers(root,folder,takeDir,render,take,observe,book.issues);
                take.media=take.clean||take.baked;for(const id of [take.media,take.baked,take.overlay,take.poster].filter(Boolean))await observe(this.assets.get(id).file);if(!take.media)throw new Error('Completed take has no readable video.');
                const base=this.assets.get(take.media).file.replace(/\.[^.]+$/,'');
                for(const [axis,suffix] of Object.entries({L0:'',L1:'.surge',L2:'.sway',R0:'.twist',R1:'.roll',R2:'.pitch'})){
                  await observe(base+suffix+'.funscript');const id=await this.asset(root,path.relative(root,base+suffix+'.funscript'),true);if(id)take.scripts[axis]=id;
                }
                const actual=render.actual_media;take.durationMs=Number(actual?.duration_seconds)*1000||0;take.width=actual?.size?.[0];take.height=actual?.size?.[1];take.audio=actual?.has_audio===true;
                panel.takes.push(take);
              }catch(e){book.issues.push(`${meta.panel_id} ${dir.name}: ${e.message}`);}
            }
            let main;try{main=await json(path.join(folder,'main_take.json'),true);}catch(e){book.issues.push(`${meta.panel_id}: main take selection is damaged; using latest completed take.`);}panel.selected=panel.takes.find(t=>t.id===main?.take_id)?.id||panel.takes[0]?.id||null;
          }catch(e){book.issues.push(`${ref.panel_id}: ${e.message}`);}
        }
      }catch(e){if(e.code!=='ENOENT')book.issues.push(`${page.label}: ${e.message}`);}
    }
    applyH3Sequence(book.pages,sequence,folders,book.issues);
    for(const page of book.pages)for(const panel of page.panels){signal?.throwIfAborted();const selected=panel.takes.find(t=>t.id===panel.selected);if(selected)try{Object.assign(selected,await this.probe(this.assets.get(selected.media).file));}catch(e){selected.error=e.message;book.issues.push(`${panel.sourceId}: ${e.message}`);}}
    signal?.throwIfAborted();const sourceIndex=this.state.sources.findIndex(s=>s.id===record.id&&s.kind==='h3');if(sourceIndex<0)this.state.sources.push(record);else this.state.sources[sourceIndex]=record;this.watches.set(book.id,watch);this.books.set(book.id,book);await this.save();return this.publicBook(book);
  }
  publicBook(book){const ids=new Set();for(const p of book.pages){if(p.image)ids.add(p.image);for(const panel of p.panels){for(const k of ['static','clean'])if(panel[k])ids.add(panel[k]);for(const t of panel.takes){for(const k of ['media','clean','baked','overlay','poster'])if(t[k])ids.add(t[k]);for(const row of t.bubbleLayers||[])ids.add(row.image);for(const id of Object.values(t.scripts||{}))ids.add(id);}}}return {...book,assets:Object.fromEntries([...ids].map(id=>[id,{url:this.url(id),size:this.assets.get(id)?.size}])),reader:this.state.readers[book.id]||{}};}
  async changed(id){const watch=this.watches.get(id);if(!watch)return false;for(const [file,before] of watch){const now=await fs.stat(file).then(s=>`${s.size}:${s.mtimeMs}`).catch(()=>null);if(now!==before)return true;}return false;}
  async reopen(key,signal){const [kind,id]=key.includes(':')?key.split(':'):[this.books.get(key)?.kind,key];const s=this.state.sources.find(s=>s.id===id&&(!kind||s.kind===kind));if(!s)throw new Error('Book not found.');if(s.kind==='package')return this.openPackage(s.source);return this.open(s.source,signal);}
  async saveReader(id,value){if(!this.state.sources.some(s=>s.id===id))throw new Error('Book not found.');if(JSON.stringify(value).length>2*1024*1024)throw new Error('Reader settings too large.');this.state.readers[id]=value;await this.save();return true;}
  async file(id){const asset=this.assets.get(id);if(!asset)throw new Error('Unknown manga asset.');if(asset.archive)return require('./manga-archive.cjs').extract(this,asset);const real=await inside(asset.root,path.relative(asset.root,asset.file)),s=await fs.stat(real);if(s.size!==asset.size||s.mtimeMs!==asset.mtime)throw new Error('Source changed. Refresh the book.');return real;}
  openPackage(file){return require('./manga-archive.cjs').openPackage(this,file);}
  exportPackage(...args){return require('./manga-archive.cjs').exportPackage(this,...args);}
  async analyzeAudio(id,panelId,takeId,signal){const book=this.books.get(id),panel=book?.pages.flatMap(p=>p.panels).find(p=>p.id===panelId),take=panel?.takes.find(t=>t.id===takeId);if(!take?.audio)throw new Error('This panel has no audio track.');
    const log=await this.command(this.ffmpeg,['-hide_banner','-i',await this.file(take.media),'-vn','-af','volumedetect','-f','null','-'],signal,true),mean=Number(/mean_volume:\s*(-?[\d.]+)/.exec(log)?.[1]),peak=Number(/max_volume:\s*(-?[\d.]+)/.exec(log)?.[1]);
    if(!Number.isFinite(mean)||!Number.isFinite(peak)||mean< -50)throw new Error('Audio is too quiet for a useful volume suggestion. Keep its original level.');
    return {mean,peak,gain:Math.round(Math.min(2,10**((-20-mean)/20),10**((-1-peak)/20))*100)/100};
  }
  get protectedFiles(){return this.runCache.protectedFiles;}
  async cleanCache(){if([...this.runCache.entries.values()].some(e=>!e.done)||[...this.jobs.values()].some(j=>j.state==='running'))throw new Error('Wait for the current manga operation before clearing its cache.');const cache=path.join(this.root,'cache');let bytes=0;for(const name of await fs.readdir(cache).catch(()=>[])){const file=path.join(cache,name);if(this.protectedFiles?.has(file))continue;const stat=await fs.stat(file);if(stat.isFile()){bytes+=stat.size;await fs.rm(file,{force:true});}}return {bytes};}
  async pruneCache(limit=4*1024**3){if([...this.runCache.entries.values()].some(e=>!e.done))return;const folder=path.join(this.root,'cache'),entries=[];for(const name of await fs.readdir(folder).catch(()=>[])){if(!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(name))continue;const file=path.join(folder,name),stat=await fs.stat(file).catch(()=>null);if(stat?.isFile())entries.push({file,...stat});}let bytes=entries.reduce((sum,e)=>sum+e.size,0);for(const entry of entries.sort((a,b)=>a.mtimeMs-b.mtimeMs)){if(bytes<=limit)break;if(this.protectedFiles?.has(entry.file))continue;await fs.rm(entry.file,{force:true});bytes-=entry.size;}return bytes;}
  async pin(id){const file=await this.file(id),hash=await hashFile(file),target=path.join(this.root,'cache',hash+path.extname(file));await fs.mkdir(path.dirname(target),{recursive:true});if(!await exists(target)){
      const temp=target+'.'+randomUUID()+'.part';try{await fs.copyFile(file,temp);if(await hashFile(temp)!==hash)throw new Error('Source changed while preparing.');await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}
    }return this.asset(path.dirname(target),path.basename(target));}
  async prepare(id,pageIndex,settings,overrides={},prefetch=false){
    const book=this.books.get(id);if(!book?.pages[pageIndex])throw new Error('Page not found.');
    const {presentation}=await import('../packages/manga-core/motion.mjs');
    settings=presentation(settings||{});const {volume,bubbles,ignoreBubbleTiming,...timing}=settings;
    const key=digest(JSON.stringify([id,book.revision,pageIndex,timing,overrides]));
    const run=await this.runCache.get(key,(files,check)=>this.buildRun(book,pageIndex,structuredClone(settings||{}),structuredClone(overrides),files,check),prefetch);
    await this.pruneCache();return run;
  }
  async buildRun(book,pageIndex,settings,overrides,files,check){
    const id=book.id;
    const page=book.pages[pageIndex];
    const {compileRun,validateScript}=await import('../packages/manga-core/motion.mjs'),{selectedTake}=await import('../packages/manga-core/sequence.mjs');const items=[],warnings=[];
    const pinned=new Map(),pin=async id=>{if(!id)return null;if(pinned.has(id))return pinned.get(id);check();const cached=await this.pin(id);files.add(await this.file(cached));check();const url=this.url(cached);pinned.set(id,url);return url;};
    // A page without detected panels still occupies reading time in autoplay.
    if(!page.panels.length&&!page.joinedOnly)items.push({id:`page:${page.id}`,pageStill:true,static:await pin(page.image)});
    const ordered=page.panels.map((panel,i)=>({panel,order:overrides[panel.id]?.order??i})).sort((a,b)=>a.order-b.order).map(v=>v.panel);
    for(const panel of ordered){check();
      const own=overrides[panel.id]||{},take=selectedTake(panel,own);
      if(panel.joined&&!take)warnings.push(`${panel.sourceId}: active join has no matching video; showing still artwork.`);
      const item={id:panel.id,static:await pin(panel.static),staticClean:await pin(panel.clean),presentation:own};
      if(take&&!take.error){const measured=await this.probe(await this.file(take.media));let baked=take.clean&&(take.overlay||take.bubbleLayers!==undefined)?null:take.baked;
        if(baked&&baked!==take.media&&!take.overlay){const variant=await this.probe(await this.file(baked));if(Math.abs(variant.durationMs-measured.durationMs)>50){baked=null;warnings.push(`${panel.sourceId}: bubble video has different timing; using the matching clean video.`);}}
        Object.assign(item,{media:await pin(take.media),baked:await pin(baked),overlay:await pin(take.overlay),poster:await pin(take.poster),...measured,scripts:{}});
        if(take.bubbleLayers!==undefined){item.bubbleLayers=[];for(const row of take.bubbleLayers)item.bubbleLayers.push({...row,image:await pin(row.image)});}
        for(const [axis,asset] of Object.entries(take.scripts))try{item.scripts[axis]=validateScript(await json(await this.file(asset)),measured.durationMs);}catch(e){warnings.push(`${panel.sourceId} ${axis}: ${e.message}`);}
      }
      items.push(item);
    }
    const run=compileRun(items,{...settings,title:`${book.title} · ${page.label}`});run.session_id=`${book.id}:${book.revision}:${page.id}`;run.bookRevision=book.revision;run.warnings=warnings;check();return run;
  }
  job(kind,work){const id=randomUUID(),controller=new AbortController(),job={id,kind,state:'running',progress:0,message:'Starting…',controller};this.jobs.set(id,job);Promise.resolve().then(()=>work(controller.signal,(progress,message)=>Object.assign(job,{progress,message}))).then(async result=>{controller.signal.throwIfAborted();await this.pruneCache();Object.assign(job,{state:'done',progress:1,result});}).catch(e=>Object.assign(job,{state:controller.signal.aborted?'cancelled':'error',error:e.message}));return {id};}
  jobState(id){const j=this.jobs.get(id);if(!j)throw new Error('Unknown job.');const {controller,...value}=j;return value;}
  cancel(id){this.jobs.get(id)?.controller.abort();}
}
module.exports={MangaService,inside,json,atomic,hashFile,digest};
