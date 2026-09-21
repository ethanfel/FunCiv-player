// Privileged Composer storage/media service. No Electron dependency: exercised by
// integration tests with real FFmpeg and synthetic media in a disposable root.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const AXES = { L0:'', L1:'.surge', L2:'.sway', R0:'.twist', R1:'.roll', R2:'.pitch' };
const VIDEO = new Set(['.mp4','.mkv','.webm','.mov','.m4v','.avi']);
const REPO = 'ethanfel/FunCiv-Data';
const hash = data => createHash('sha256').update(data).digest('hex');
const core = () => import('../packages/composer-core/index.mjs');

async function atomic(file, value) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp,JSON.stringify(value),{mode:0o600}); await fs.rename(temp,file); }
  finally { await fs.rm(temp,{force:true}); }
}
async function readJSON(file, fallback) {
  try { return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')); }
  catch(e) { if(e.code==='ENOENT' && fallback !== undefined)return fallback;throw e; }
}
async function fileHash(file) {
  const stream = require('node:fs').createReadStream(file), h = createHash('sha256');
  for await (const chunk of stream) h.update(chunk);
  return h.digest('hex');
}

class ComposerService {
  constructor(root,{ffmpeg='ffmpeg',ffprobe='ffprobe',fetchImpl=globalThis.fetch,getToken=()=>''}={}) {
    this.root=root;this.ffmpeg=ffmpeg;this.ffprobe=ffprobe;this.fetch=fetchImpl;this.getToken=getToken;
    this.catalog={version:1,clips:[],songs:[],roots:[],dataset:null};this.jobs=new Map();this.saving=Promise.resolve();
  }
  async init(){await fs.mkdir(this.root,{recursive:true});this.catalog=await readJSON(path.join(this.root,'catalog.json'),this.catalog);return this;}
  saveCatalog(){const value=structuredClone(this.catalog);this.saving=this.saving.catch(()=>{}).then(()=>atomic(path.join(this.root,'catalog.json'),value));return this.saving;}
  state(){return structuredClone({...this.catalog,clips:this.catalog.clips.map(({scripts,...clip})=>({...clip,axes:Object.keys(scripts||clip.remote_scripts||{}),script_ready:!!scripts?.L0}))});}
  async run(binary,args,signal,onProgress){
    return new Promise((resolve,reject)=>{
      const child=spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});let out='',err='';
      child.stdout.on('data',d=>{out+=d;if(out.length>16*1024*1024){child.kill('SIGTERM');reject(new Error('Media tool returned too much data.'));}onProgress?.(d.toString());});
      child.stderr.on('data',d=>{err=(err+d).slice(-6000);});
      child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(new Error(err||`Media tool exited with ${code}.`)));
    });
  }
  async probe(file,signal){
    const data=JSON.parse(await this.run(this.ffprobe,['-v','error','-show_format','-show_streams','-of','json',file],signal));
    const duration=Number(data.format?.duration),video=data.streams?.find(s=>s.codec_type==='video'),audio=data.streams?.find(s=>s.codec_type==='audio');
    if(!Number.isFinite(duration)||duration<=0)throw new Error(`Cannot determine duration of ${path.basename(file)}.`);
    return {duration_ms:Math.round(duration*1000),...(video?{width:video.width,height:video.height}:{}),video:!!video,audio:!!audio};
  }
  startJob(kind,operation){
    if([...this.jobs.values()].some(j=>j.state==='running'))throw new Error('Wait for the current task or cancel it first.');
    const id=randomUUID(),controller=new AbortController(),job={id,kind,state:'running',progress:0,message:'Starting…',controller};this.jobs.set(id,job);
    const update=(progress,message)=>{job.progress=progress;job.message=message;};
    Promise.resolve().then(()=>operation(controller.signal,update)).then(result=>{job.result=result;job.state='completed';job.progress=1;job.message='Complete';},e=>{job.state=controller.signal.aborted?'cancelled':'failed';job.error=e.message;job.message=job.state;});
    return {id};
  }
  job(id){const job=this.jobs.get(id);if(!job)throw new Error('Job not found.');const {controller,...publicJob}=job;return publicJob;}
  cancel(id){const job=this.jobs.get(id);if(job?.state==='running')job.controller.abort();return this.job(id);}
  async importSong(file,signal,update=()=>{}){
    const stat=await fs.stat(file);if(!stat.isFile())throw new Error('Choose an audio file.');
    update(.1,'Reading song…');const digest=await fileHash(file),id=`song-${digest.slice(0,24)}`,dest=path.join(this.root,'audio',`${id}.wav`);
    await fs.mkdir(path.dirname(dest),{recursive:true});
    try {await fs.access(dest);}catch{
      const tmp=dest+'.part';try{await this.run(this.ffmpeg,['-v','error','-nostdin','-y','-i',file,'-vn','-ar','48000','-ac','2','-c:a','pcm_s16le','-f','wav',tmp],signal);await fs.rename(tmp,dest);}finally{await fs.rm(tmp,{force:true});}
    }
    const info=await this.probe(dest,signal);const song={id,name:path.basename(file),path:dest,original_path:file,sha256:digest,...info,url:pathToFileURL(dest).href};
    this.catalog.songs=this.catalog.songs.filter(s=>s.id!==id);this.catalog.songs.push(song);await this.saveCatalog();update(1,'Song ready');return song;
  }
  async scan(root,signal,update=()=>{}){
    root=await fs.realpath(root);const files=[],warnings=[];
    const walk=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){signal?.throwIfAborted();if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(VIDEO.has(path.extname(file).toLowerCase()))files.push(file);}};
    await walk(root);const found=[];const {validateActions}=await core();
    for(let i=0;i<files.length;i++){
      signal?.throwIfAborted();const file=files[i];update(i/Math.max(1,files.length),`Scanning ${i+1}/${files.length}`);
      try{
        const stat=await fs.stat(file),id=`local-${hash(file).slice(0,24)}`,existing=this.catalog.clips.find(c=>c.id===id);
        const info=existing?.size===stat.size&&existing?.mtime===stat.mtimeMs?{...existing,video:true}:await this.probe(file,signal);
        if(!info.video)continue;
        const base=file.slice(0,-path.extname(file).length),scripts={};
        for(const [axis,suffix] of Object.entries(AXES)){
          try{const data=await readJSON(base+suffix+'.funscript');validateActions(data.actions);scripts[axis]=data;}
          catch(e){if(e.code!=='ENOENT')warnings.push(`${path.basename(file)} ${axis}: ${e.message}`);}
        }
        const relative=path.relative(root,path.dirname(file)),category=relative||path.basename(root);
        found.push({id,name:path.basename(file),path:file,url:pathToFileURL(file).href,root,duration_ms:info.duration_ms,width:info.width,height:info.height,
          categories:existing?.manual_categories?existing.categories:[category],manual_categories:existing?.manual_categories||false,
          ...(existing?.user_rating !== undefined ? {user_rating:existing.user_rating} : {}),
          civitai_id:/(?:^|_)civitai_([1-9]\d*)(?:_|\.)/i.exec(path.basename(file))?.[1]||null,
          review_status:existing?.review_status||'local',scripts,available:true,size:stat.size,mtime:stat.mtimeMs});
      }catch(e){if(signal?.aborted)throw e;warnings.push(`${path.basename(file)}: ${e.message}`);}
    }
    const old=this.catalog.clips.filter(c=>c.root===root);for(const c of old)if(!found.some(f=>f.id===c.id))c.available=false;
    this.catalog.clips=this.catalog.clips.filter(c=>!found.some(f=>f.id===c.id)).concat(found);
    if(!this.catalog.roots.includes(root))this.catalog.roots.push(root);
    await this.saveCatalog();return {count:found.length,warnings};
  }
  async tag(id,category){const c=this.catalog.clips.find(c=>c.id===id);if(!c)throw new Error('Clip not found.');category=String(category).trim();if(!category||category.length>160)throw new Error('Enter a category of 1–160 characters.');c.categories=[category];c.manual_categories=true;await this.saveCatalog();return this.state();}
  async rate(id,rating){
    if(rating!==null&&(!Number.isInteger(rating)||rating<0||rating>5))throw new Error('Rating must be an integer from 0 to 5, or null to reset.');
    const clip=this.catalog.clips.find(c=>c.id===id);if(!clip)throw new Error('Clip not found.');
    if(rating===null)delete clip.user_rating;else clip.user_rating=rating;
    await this.saveCatalog();return this.state();
  }
  async bytes(url,{signal,max=20*1024*1024,token='',media=false}={}){
    const allowed=media?new Set(['image.civitai.com','image.civitai.red','blobs-b2.civitai.com']):new Set(['huggingface.co','civitai.com','civitai.red','civitaired.com']);
    let current=url;
    for(let n=0;n<5;n++){
      const parsed=new URL(current);if(parsed.protocol!=='https:'||!allowed.has(parsed.hostname)||parsed.username||parsed.password)throw new Error('Unsupported remote address.');
      const response=await this.fetch(current,{redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),headers:token&&!media?{Authorization:`Bearer ${token}`}:{}});
      if(response.status>=300&&response.status<400){if(token)throw new Error('Metadata API redirected. Select the current Civitai site.');current=new URL(response.headers.get('location'),current).href;continue;}
      if(!response.ok)throw new Error(`Remote request failed (${response.status}).${response.status===429?' Rate limited; try again later.':''}`);
      if(Number(response.headers.get('content-length'))>max)throw new Error('Remote file exceeds the allowed size.');
      const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>max)throw new Error('Remote response is too large.');chunks.push(chunk);}return Buffer.concat(chunks);
    }
    throw new Error('Too many redirects.');
  }
  async refreshDataset(signal,update=()=>{}){
    const info=JSON.parse(await this.bytes(`https://huggingface.co/api/datasets/${REPO}`,{signal}));
    if(!/^[a-f0-9]{40}$/.test(info.sha))throw new Error('Dataset did not return a commit.');
    const base=`https://huggingface.co/datasets/${REPO}/raw/${info.sha}/`;
    const manifest=JSON.parse(await this.bytes(base+'manifest.json',{signal}));
    if(manifest.schema!=='s3f-public-funscripts/1')throw new Error('Unsupported dataset schema.');
    const content=await this.bytes(base+'data/catalog.jsonl',{signal});
    if(hash(content)!==manifest.files?.['data/catalog.jsonl'])throw new Error('Dataset catalog checksum mismatch.');
    const rows=content.toString('utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),incoming=[];
    for(const row of rows){
      if(!/^[1-9]\d{0,15}$/.test(row.civitai_id)||!/^[a-f0-9]{64}$/.test(row.variant_id)||!Number.isFinite(row.duration_ms)||row.duration_ms<=0)throw new Error('Invalid dataset row.');
      const id=`hf-${row.civitai_id}-${row.variant_id.slice(0,20)}`,existing=this.catalog.clips.find(c=>c.id===id);
      const local=this.catalog.clips.find(c=>c.civitai_id===row.civitai_id&&c.available&&c.path&&Math.abs(c.duration_ms-row.duration_ms)<150);
      incoming.push({...existing,id,name:`Civitai ${row.civitai_id}`,civitai_id:row.civitai_id,variant_id:row.variant_id,
        duration_ms:row.duration_ms,categories:existing?.categories||local?.categories||['Uncategorized'],review_status:row.review_status,quality:row.quality,
        preferred:row.preferred,origin:'dataset',commit:info.sha,remote_scripts:row.scripts,
        // An earlier prepared binding remains tied to its revision; fetching a new catalog doesn't replace saved sessions.
        scripts:existing?.commit===info.sha?existing.scripts:undefined,path:existing?.path||local?.path,url:existing?.url||local?.url,
        available:!!(existing?.path||local?.path),binding:'duration-compatible'});
    }
    this.catalog.clips=this.catalog.clips.filter(c=>c.origin!=='dataset').concat(incoming);
    this.catalog.dataset={repo:REPO,commit:info.sha,count:incoming.length,updated_at:new Date().toISOString()};
    await this.saveCatalog();update(1,'Dataset catalog verified');return this.catalog.dataset;
  }
  async downloadMedia(url,dest,signal){
    let current=url;const allowed=new Set(['image.civitai.com','image.civitai.red','blobs-b2.civitai.com']);
    for(let n=0;n<5;n++){
      const parsed=new URL(current);if(parsed.protocol!=='https:'||!allowed.has(parsed.hostname)||parsed.username||parsed.password)throw new Error('Unsupported media address.');
      const response=await this.fetch(current,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(15*60*1000)])});
      if(response.status>=300&&response.status<400){current=new URL(response.headers.get('location'),current).href;continue;}
      if(!response.ok)throw new Error(`Video download failed (${response.status}).`);
      let size=0;const limit=new Transform({transform(chunk,enc,done){size+=chunk.length;done(size>4*1024**3?new Error('Video exceeds 4 GB.'):null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(dest,{flags:'wx'}),{signal});return;
    }
    throw new Error('Too many media redirects.');
  }
  async resolveClip(id,site,signal,update=()=>{}){
    const clip=this.catalog.clips.find(c=>c.id===id);if(!clip)throw new Error('Clip not found.');
    if(clip.origin!=='dataset')return clip;
    if(!['civitai.com','civitai.red','civitaired.com'].includes(site))throw new Error('Choose a supported Civitai site.');
    const {validateActions}=await core(),scripts={};
    for(const [axis,descriptor] of Object.entries(clip.remote_scripts)){
      signal.throwIfAborted();if(!AXES.hasOwnProperty(axis))continue;
      if(!/^scripts\/[a-f0-9]{2}\/[a-f0-9]{64}\/[a-f0-9]{64}(\.(surge|sway|twist|roll|pitch))?\.funscript$/.test(descriptor.path)||!/^[a-f0-9]{64}$/.test(descriptor.sha256))throw new Error('Invalid script descriptor.');
      update(.1,`Fetching ${axis} script…`);const bytes=await this.bytes(`https://huggingface.co/datasets/${REPO}/raw/${clip.commit}/${descriptor.path}`,{signal});
      if(hash(bytes)!==descriptor.sha256)throw new Error(`${axis} script checksum mismatch.`);
      const data=JSON.parse(bytes);validateActions(data.actions);scripts[axis]=data;
    }
    let file=clip.path;try{await fs.access(file);}catch{file=null;}
    if(!file){
      update(.3,'Resolving Civitai video…');
      const result=JSON.parse(await this.bytes(`https://${site}/api/v1/images?imageId=${clip.civitai_id}&type=video&browsingLevel=31`,{signal,token:await this.getToken()}));
      const item=result.items?.find(v=>String(v.id)===clip.civitai_id&&v.type==='video');if(!item)throw new Error('Video is unavailable through this Civitai account/site.');
      const raw=new URL(item.url),parts=raw.pathname.split('/');if(parts.length<4||!parts.at(-2).includes('='))throw new Error('Unsupported original media URL.');
      const directory=path.join(this.root,'downloads');await fs.mkdir(directory,{recursive:true});
      file=path.join(directory,`civitai_${clip.civitai_id}_${clip.variant_id.slice(0,16)}_${clip.commit.slice(0,12)}.mp4`);let downloaded=false,lastError;
      for(const transform of ['original=true','original=true,quality=100','transcode=true,original=true,quality=100']){
        const tmp=file+'.'+randomUUID()+'.part';
        try{const url=new URL(raw);parts[parts.length-2]=transform;url.pathname=parts.join('/');url.search='';update(.4,'Downloading selected video…');await this.downloadMedia(url.href,tmp,signal);const info=await this.probe(tmp,signal);if(!info.video||Math.abs(info.duration_ms-clip.duration_ms)>150)throw new Error('Downloaded video duration does not match the script.');await fs.rename(tmp,file);downloaded=true;break;}
        catch(e){lastError=e;if(signal.aborted)throw e;}finally{await fs.rm(tmp,{force:true});}
      }
      if(!downloaded)throw lastError;
    }
    const info=await this.probe(file,signal);if(!info.video||Math.abs(info.duration_ms-clip.duration_ms)>150)throw new Error('Video duration differs from this script variant. Choose a different local copy.');
    const stat=await fs.stat(file);
    Object.assign(clip,{path:file,url:pathToFileURL(file).href,available:true,scripts,binding:'duration-compatible',size:stat.size,mtime:stat.mtimeMs});
    await this.saveCatalog();return {id:clip.id,axes:Object.keys(scripts),binding:clip.binding};
  }
  async sessionList(){const dir=path.join(this.root,'sessions');await fs.mkdir(dir,{recursive:true});const result=[];for(const name of await fs.readdir(dir)){if(!name.endsWith('.json'))continue;try{const s=await readJSON(path.join(dir,name));result.push({id:s.id,name:s.name,revision:s.revision});}catch{}}return result;}
  sessionPath(id){if(!/^[\w-]{1,80}$/.test(id))throw new Error('Invalid session ID.');return path.join(this.root,'sessions',id+'.json');}
  saveSession(session){
    const operation=async()=>{const {validateSession}=await core();validateSession(session);const file=this.sessionPath(session.id),old=await readJSON(file,null);
      if(old&&old.revision!==session.revision)throw new Error('A newer saved session exists. Reopen it before saving.');
      const next={...session,revision:session.revision+1};
      if(session.placements.length)next.asset_bindings=this.bindings(await this.clipsForSession(session));
      await atomic(file,next);return next;};
    this.sessionSaving=(this.sessionSaving||Promise.resolve()).catch(()=>{}).then(operation);return this.sessionSaving;
  }
  loadSession(id){return readJSON(this.sessionPath(id));}
  async clipsForSession(session){
    const ids=new Set(session.placements.map(p=>p.clip_id)),clips=[];
    for(const id of ids){const c=this.catalog.clips.find(c=>c.id===id);if(!c?.path)throw new Error('Resolve the selected clips first.');const stat=await fs.stat(c.path);
      if(stat.size!==c.size||stat.mtimeMs!==c.mtime)throw new Error(`${c.name} changed. Rescan or resolve the clip before playback.`);
      if(c.origin!=='dataset')for(const [axis,script] of Object.entries(c.scripts||{})){
        const file=c.path.slice(0,-path.extname(c.path).length)+AXES[axis]+'.funscript';
        if(hash(JSON.stringify(await readJSON(file)))!==hash(JSON.stringify(script)))throw new Error(`${c.name} motion changed. Rescan before playback.`);
      }
      const binding=this.bindings([c])[c.id];
      if(session.asset_bindings?.[id]&&JSON.stringify(session.asset_bindings[id])!==JSON.stringify(binding))throw new Error(`${c.name} differs from the saved session. Reassemble to adopt the updated asset.`);
      clips.push(structuredClone(c));}
    return clips;
  }
  bindings(clips){return Object.fromEntries(clips.map(c=>[c.id,{commit:c.commit||null,variant:c.variant_id||null,size:c.size,mtime:c.mtime,scripts:hash(JSON.stringify(c.scripts||{}))}]));}
  async prepare(session){
    const song=this.catalog.songs.find(s=>s.id===session.song?.id);
    if(!song||song.duration_ms!==session.song.duration_ms)throw new Error('Song is missing or its duration changed. Import it again.');
    await fs.access(song.path);
    const clips=await this.clipsForSession(session),{compile}=await core();
    return {snapshot:compile({...session,song},clips),clips,asset_bindings:this.bindings(clips)};
  }
  async renderScripts(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid render ID.');return Object.fromEntries(await Promise.all(Object.entries(AXES).map(async([axis,suffix])=>[axis,await readJSON(path.join(this.root,'renders',id,'session'+suffix+'.funscript'))])));}
  async deleteRender(id){
    if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid render ID.');
    const dir=path.join(this.root,'renders',id),stat=await fs.lstat(dir);
    if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Not an owned render directory.');
    const manifest=await readJSON(path.join(dir,'manifest.json'));
    if(manifest.schema!=='funciv-render/1'||manifest.id!==id)throw new Error('Not a FunCiv render.');
    await fs.rm(dir,{recursive:true});return {deleted:true};
  }
  async render(session,signal,update=()=>{}){
    const {snapshot,clips}=await this.prepare(session),song=this.catalog.songs.find(s=>s.id===session.song.id);
    if(!song)throw new Error('Song is not in the catalog. Import it again.');
    const id=randomUUID(),directory=path.join(this.root,'renders',id);await fs.mkdir(directory,{recursive:true});
    const byId=new Map(clips.map(c=>[c.id,c])),fps=30,parts=[];let finished=false;
    try{
      for(let i=0;i<snapshot.placements.length;i++){
        signal.throwIfAborted();const p=snapshot.placements[i],clip=byId.get(p.clip_id),file=path.join(directory,`part-${i}.mp4`);
        // Quantize absolute boundaries rather than rounding each clip duration.
        const frames=Math.round(p.end_ms*fps/1000)-Math.round(p.start_ms*fps/1000);if(frames<=0)continue;
        update(i/(snapshot.placements.length+1),`Rendering clip ${i+1}/${snapshot.placements.length}`);
        const filter=`setpts=(PTS-STARTPTS)/${p.rate},scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=1`;
        await this.run(this.ffmpeg,['-v','error','-nostdin','-y','-ss',String(p.source_in_ms/1000),'-i',clip.path,'-an','-vf',filter,'-frames:v',String(frames),'-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-threads','2',file],signal);parts.push(path.basename(file));
      }
      await fs.writeFile(path.join(directory,'concat.txt'),parts.map(p=>`file '${p}'`).join('\n'));
      update(.95,'Adding song and writing scripts…');const video=path.join(directory,'session.mp4');
      await this.run(this.ffmpeg,['-v','error','-nostdin','-y','-f','concat','-safe','1','-i',path.join(directory,'concat.txt'),'-i',song.path,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(snapshot.duration_ms/1000),'-movflags','+faststart',video],signal);
      for(const [axis,suffix] of Object.entries(AXES))await atomic(path.join(directory,'session'+suffix+'.funscript'),snapshot.scripts[axis]);
      const info=await this.probe(video,signal);if(Math.abs(info.duration_ms-snapshot.duration_ms)>100)throw new Error('Export duration validation failed.');
      await atomic(path.join(directory,'manifest.json'),{schema:'funciv-render/1',id,session,created_at:new Date().toISOString(),assets:this.bindings(clips),video_sha256:await fileHash(video),duration_ms:info.duration_ms});
      for(const part of parts)await fs.rm(path.join(directory,part));await fs.rm(path.join(directory,'concat.txt'));
      finished=true;return {id,path:video,scriptPath:path.join(directory,'session.funscript'),name:session.name+'.mp4',duration_ms:info.duration_ms};
    }finally{if(!finished)await fs.rm(directory,{recursive:true,force:true});}
  }
}
module.exports={ComposerService,atomic,hash,AXES};
