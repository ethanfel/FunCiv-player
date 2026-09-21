import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComposerService, hash } from '../../electron/composer-service.cjs';
import { createSession, arrange, clipRating, planRegions, slipSource } from '../../packages/composer-core/index.mjs';

test('local import → arrangement → persisted recipe → real FFmpeg render',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-service-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const service=await new ComposerService(path.join(root,'data')).init(),signal=new AbortController().signal;
  const library=path.join(root,'clips');await fs.mkdir(library);
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=teal:s=160x90:r=30:d=1.2','-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',path.join(library,'clip.mp4')],signal);
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:duration=2.8',path.join(root,'song.wav')],signal);
  const script={actions:[{at:0,pos:10},{at:300,pos:90},{at:600,pos:10},{at:900,pos:90},{at:1200,pos:10}]};
  await fs.writeFile(path.join(library,'clip.funscript'),JSON.stringify(script));
  const result=await service.scan(library,signal);assert.equal(result.count,1);assert.equal(result.warnings.length,0);
  const clipId=service.state().clips[0].id;await service.rate(clipId,5);await service.scan(library,signal);
  assert.equal(service.state().clips[0].user_rating,5,'local ratings survive rescans');
  const song=await service.importSong(path.join(root,'song.wav'),signal);assert.equal(song.duration_ms,2800);
  const draft={...createSession(song,1),repeat_policy:'cycle'},planned=planRegions(draft,draft.sections[0].id,[700,1400,2100]);
  const savedPlan=await service.saveSession(planned);assert.deepEqual((await service.loadSession(savedPlan.id)).placements,planned.placements);
  await assert.rejects(()=>service.prepare(savedPlan),/regions are empty/);
  const assigned=arrange(savedPlan,service.state().clips),trimmed=slipSource(assigned,assigned.placements[0].id,200,service.state().clips);
  const savedTrim=await service.saveSession(trimmed);assert.equal((await service.loadSession(savedTrim.id)).placements[0].source_in_ms,200);
  const trimPreview=await service.prepare(savedTrim);assert.equal(trimPreview.snapshot.placements[0].source_in_ms,200);
  const initial=arrange({...createSession(song,2),min_rating:5,repeat_policy:'cycle'},service.state().clips);delete initial.output; // Legacy landscape recipe.
  const saved=await service.saveSession(initial);
  assert.equal(saved.revision,1);assert.deepEqual(await service.loadSession(saved.id),saved);
  await assert.rejects(()=>service.saveSession(initial),/newer saved session/);
  const prepared=await service.prepare(saved);assert.equal(prepared.snapshot.placements.length,4);
  await service.rate(clipId,4);
  await assert.rejects(()=>service.prepare(saved),/below the 5★ minimum/);
  await assert.rejects(()=>service.render(saved,signal),/below the 5★ minimum/);
  await service.rate(clipId,5);assert.equal((await service.prepare(saved)).snapshot.placements.length,4,'rating changes do not alter media bindings');
  const render=await service.render(saved,signal);
  assert.ok(Math.abs(render.duration_ms-2800)<=100);
  const info=await service.probe(render.path,signal);assert.ok(info.video&&info.audio);assert.equal(info.width,1280);assert.equal(info.height,720);
  const scripts=await service.renderScripts(render.id);assert.deepEqual(scripts,prepared.snapshot.scripts);
  const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(render.path),'manifest.json')));assert.equal(manifest.video_sha256,hash(await fs.readFile(render.path)));
  assert.equal((await fs.readdir(path.dirname(render.path))).filter(n=>n.startsWith('part-')).length,0);
  await fs.writeFile(path.join(library,'clip.funscript'),JSON.stringify({actions:[{at:0,pos:50}]}));
  await assert.rejects(()=>service.prepare(saved),/motion changed/);
  await service.scan(library,signal);await assert.rejects(()=>service.prepare(saved),/differs from the saved session/);
  const adopted=arrange(saved,service.state().clips);await service.prepare(adopted);
  const controller=new AbortController();controller.abort();await assert.rejects(()=>service.render(adopted,controller.signal));
  assert.equal((await fs.readdir(path.join(root,'data','renders'))).length,1,'cancelled render leaves no partial export');
  await assert.rejects(()=>service.deleteRender('../clips'),/Invalid render/);
  await service.deleteRender(render.id);assert.equal((await fs.readdir(path.join(root,'data','renders'))).length,0);
  await fs.access(path.join(library,'clip.mp4'));
});

test('portrait export fills mixed resolutions with centered crops, square pixels and matching scripts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-portrait-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const service=await new ComposerService(path.join(root,'data')).init(),signal=new AbortController().signal;
  const library=path.join(root,'clips');await fs.mkdir(library);
  const fixtures=[
    {name:'wide',size:'320x180',fps:24,borders:'drawbox=x=0:y=0:w=80:h=ih:color=red:t=fill,drawbox=x=240:y=0:w=80:h=ih:color=red:t=fill',markerWidth:20},
    {name:'square',size:'160x160',fps:25,borders:'drawbox=x=0:y=0:w=30:h=ih:color=red:t=fill,drawbox=x=130:y=0:w=30:h=ih:color=red:t=fill',markerWidth:20},
    {name:'tall',size:'90x320',fps:60,borders:'drawbox=x=0:y=0:w=iw:h=80:color=red:t=fill,drawbox=x=0:y=240:w=iw:h=80:color=red:t=fill',markerWidth:20},
    {name:'portrait',size:'180x320',fps:30,markerWidth:20},
    {name:'anamorphic',size:'160x180',fps:30,borders:'drawbox=x=0:y=0:w=40:h=ih:color=red:t=fill,drawbox=x=120:y=0:w=40:h=ih:color=red:t=fill',markerWidth:10,sar:'2/1'},
  ];
  for(const f of fixtures){
    const filter=[f.borders,`drawbox=x=(iw-${f.markerWidth})/2:y=(ih-20)/2:w=${f.markerWidth}:h=20:color=white:t=fill`,`setsar=${f.sar||1}`].filter(Boolean).join(',');
    await service.run('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=0x20a080:s=${f.size}:r=${f.fps}:d=1`,'-vf',filter,'-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',path.join(library,f.name+'.mp4')],signal);
  }
  // Rotation metadata is applied before display-aspect scaling.
  await service.run('ffmpeg',['-v','error','-display_rotation:v:0','90','-i',path.join(library,'wide.mp4'),'-c','copy',path.join(library,'rotated.mp4')],signal);
  const rotated=JSON.parse(await service.run('ffprobe',['-v','error','-show_streams','-of','json',path.join(library,'rotated.mp4')],signal));
  assert.ok(rotated.streams[0].side_data_list?.some(s=>s.rotation===90),'fixture carries a rotation matrix');
  fixtures.push({name:'rotated',redCorners:true});
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i',`sine=frequency=220:duration=${fixtures.length}`,path.join(root,'song.wav')],signal);
  await service.scan(library,signal);const song=await service.importSong(path.join(root,'song.wav'),signal);
  for(const c of service.catalog.clips)await service.tag(c.id,c.name);
  const session=createSession(song,fixtures.length);session.sections.forEach((s,i)=>{s.category=fixtures[i].name+'.mp4';s.motion='hold';});
  const saved=await service.saveSession(arrange(session,service.state().clips));
  assert.deepEqual((await service.loadSession(saved.id)).output,{preset:'portrait-1080',fit:'cover'});
  const prepared=await service.prepare(saved),render=await service.render(saved,signal);
  const info=JSON.parse(await service.run('ffprobe',['-v','error','-show_streams','-of','json',render.path],signal));
  const video=info.streams.find(s=>s.codec_type==='video');
  assert.equal(video.width,1080);assert.equal(video.height,1920);assert.equal(video.sample_aspect_ratio,'1:1');assert.equal(video.avg_frame_rate,'30/1');
  assert.deepEqual(await service.renderScripts(render.id),prepared.snapshot.scripts);
  const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(render.path),'manifest.json')));
  assert.deepEqual(manifest.output,prepared.snapshot.output);
  for(let i=0;i<fixtures.length;i++){
    const file=path.join(root,`frame-${i}.rgb`);
    await service.run('ffmpeg',['-v','error','-ss',String(i+.5),'-i',render.path,'-frames:v','1','-vf','scale=108:192:flags=neighbor','-pix_fmt','rgb24','-f','rawvideo','-threads','1',file],signal);
    const data=await fs.readFile(file);assert.equal(data.length,108*192*3);
    for(const [x,y] of [[3,3],[104,3],[3,188],[104,188]]){
      const [r,g,b]=data.subarray((y*108+x)*3,(y*108+x)*3+3);
      assert.ok(fixtures[i].redCorners?r>180&&g<60:g>100&&r<90&&b>70,`${fixtures[i].name}: crop corners contain the expected image, not padding or discarded edges (${r},${g},${b})`);
    }
    const white=[];for(let y=0;y<192;y++)for(let x=0;x<108;x++)if(data.subarray((y*108+x)*3,(y*108+x)*3+3).every(v=>v>225))white.push([x,y]);
    assert.ok(white.length>0);const xs=white.map(p=>p[0]),ys=white.map(p=>p[1]);
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    assert.ok(Math.abs((right-left+1)/(bottom-top+1)-1)<.15,`${fixtures[i].name}: square marker is not stretched`);
    assert.ok(Math.abs((left+right)/2-53.5)<2&&Math.abs((top+bottom)/2-95.5)<2,`${fixtures[i].name}: crop is centered`);
  }
});

test('local rating overrides survive dataset refresh and restart; reset restores source quality',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-rating-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let quality=5;
  const row=()=>({civitai_id:'123',variant_id:'b'.repeat(64),duration_ms:1000,quality,review_status:'approved',scripts:{}});
  const service=await new ComposerService(root,{fetchImpl:async url=>{
    const content=JSON.stringify(row())+'\n';
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:'a'.repeat(40)}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':hash(content)}}));
    return new Response(content);
  }}).init();
  await service.refreshDataset();const id=service.state().clips[0].id;
  await service.rate(id,4);quality=3;await service.refreshDataset();
  assert.equal(service.state().clips[0].quality,3);assert.equal(clipRating(service.state().clips[0]),4);
  const reopened=await new ComposerService(root).init();assert.equal(clipRating(reopened.state().clips[0]),4);
  await reopened.rate(id,0);assert.equal(clipRating(reopened.state().clips[0]),0);
  await reopened.rate(id,null);assert.equal(clipRating(reopened.state().clips[0]),3);
  assert.equal(reopened.state().clips[0].user_rating,undefined);
  for(const rating of [undefined,'5',-1,6,4.5])await assert.rejects(()=>reopened.rate(id,rating),/Rating must/);
  await assert.rejects(()=>reopened.rate('missing',5),/Clip not found/);
});

test('HF categories migrate old entries, refresh automatically and preserve manual overrides',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-categories-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let metadata={},revision='a';
  const fetchImpl=async url=>{
    const content=JSON.stringify({civitai_id:'123',variant_id:'b'.repeat(64),duration_ms:1000,quality:5,review_status:'draft',scripts:{},...metadata})+'\n';
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:revision.repeat(40)}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',review_policy:'all-drafts',files:{'data/catalog.jsonl':hash(content)}}));
    return new Response(content);
  };
  const service=await new ComposerService(root,{fetchImpl}).init();
  await service.refreshDataset();const id=service.state().clips[0].id,remote=()=>service.state().clips.find(c=>c.id===id);
  assert.deepEqual(remote().categories,['Uncategorized'],'old snapshots remain readable');
  await service.rate(id,4);
  // Put a matching local file after the old remote row to catch remote self-matching.
  const file=path.join(root,'fixture.mp4');await fs.writeFile(file,'synthetic file identity');const stat=await fs.stat(file);
  service.catalog.clips.push({id:'local-fixture',civitai_id:'123',path:file,size:stat.size,mtime:stat.mtimeMs,available:true,duration_ms:1000,categories:['Local folder']});
  metadata={categories:['Flow','Pulse','Flow'],category_paths:['Season/Flow','Season/Pulse']};revision='c';
  await service.refreshDataset();
  assert.equal(remote().id,id);assert.deepEqual(remote().categories,['Flow','Pulse']);assert.equal(remote().manual_categories,false);
  assert.deepEqual(remote().category_paths,metadata.category_paths);assert.equal(remote().user_rating,4);assert.equal(remote().review_status,'draft');
  const song={id:'song',duration_ms:1000,name:'Synthetic song'},session=createSession(song,1);
  session.include_drafts=true;session.min_rating=4;session.sections[0].motion='hold';session.sections[0].categories=['Pulse'];
  assert.equal(arrange(session,service.state().clips).placements[0].clip_id,id,'published labels feed section matching');
  session.include_drafts=false;assert.throws(()=>arrange(session,service.state().clips),/No usable clips/,'categories do not bypass draft policy');
  await service.tag(id,'My category');metadata={categories:['Revised','Flow'],category_paths:['New/Revised','New/Flow']};revision='d';
  await service.refreshDataset();
  assert.deepEqual(remote().categories,['My category']);assert.deepEqual(remote().dataset_categories,metadata.categories);
  assert.deepEqual(remote().automatic_categories,metadata.categories);assert.deepEqual(remote().category_paths,metadata.category_paths);
  const reopened=await new ComposerService(root,{fetchImpl}).init();
  assert.equal(reopened.state().clips.find(c=>c.id===id).manual_categories,true);
  await reopened.tag(id,null);assert.deepEqual(reopened.state().clips.find(c=>c.id===id).categories,['Revised','Flow']);
  assert.equal(reopened.state().clips.find(c=>c.id===id).manual_categories,false);
  await reopened.tag(id,'Uncategorized');await reopened.refreshDataset();
  assert.deepEqual(reopened.state().clips.find(c=>c.id===id).categories,['Uncategorized'],'an explicit override remains intentional');
  metadata={categories:[],category_paths:[]};await reopened.refreshDataset();await reopened.tag(id,null);
  assert.deepEqual(reopened.state().clips.find(c=>c.id===id).categories,['Local folder'],'empty public labels use an available local folder');
  reopened.catalog.clips=reopened.catalog.clips.filter(c=>c.id!=='local-fixture');await reopened.refreshDataset();
  assert.deepEqual(reopened.state().clips[0].categories,['Uncategorized']);
  const before=reopened.state();
  for(const invalid of [{categories:'Flow'},{categories:[12]},{categories:['']},{categories:['x'.repeat(161)]},{category_paths:[null]}]){
    metadata=invalid;await assert.rejects(()=>reopened.refreshDataset(),/Invalid dataset categor/);
    assert.deepEqual(reopened.state(),before,'malformed labels cannot replace the catalog');
  }
});

test('HF all-drafts catalog resolves checked scripts against a local video and persists explicit use',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-drafts-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const commit='a'.repeat(40),key=hash('civitai:123'),variant='b'.repeat(64),signal=new AbortController().signal,calls=[];
  const script=JSON.stringify({actions:[{at:0,pos:10},{at:500,pos:90},{at:1000,pos:10}]}),scriptPath=`scripts/${key.slice(0,2)}/${key}/${variant}.funscript`;
  let review_policy='all-drafts',review_status='draft',audio_sync,corrupt=false;
  const service=await new ComposerService(path.join(root,'data'),{fetchImpl:async url=>{
    calls.push(url);
    const content=JSON.stringify({civitai_id:'123',variant_id:variant,duration_ms:1000,quality:5,review_status,audio_sync,scripts:{L0:{path:scriptPath,sha256:hash(script)}}})+'\n';
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:commit}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',review_policy,files:{'data/catalog.jsonl':hash(content)}}));
    if(url.endsWith('data/catalog.jsonl'))return new Response(content);
    assert.equal(url,`https://huggingface.co/datasets/ethanfel/FunCiv-Data/raw/${commit}/${scriptPath}`);
    return new Response(corrupt?'{}':script);
  }}).init();
  const library=path.join(root,'clips');await fs.mkdir(library);
  const video=path.join(library,'fixture_civitai_123_test.mp4');
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=teal:s=160x90:r=30:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',video],signal);
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:duration=1',path.join(root,'song.wav')],signal);
  await service.scan(library,signal);const song=await service.importSong(path.join(root,'song.wav'),signal);
  await service.refreshDataset();const draft=service.state().clips.find(c=>c.origin==='dataset');
  assert.equal(draft.path,video);assert.equal(draft.review_status,'draft');assert.equal(draft.script_ready,false);
  assert.deepEqual(service.state().dataset.review_counts,{draft:1,approved:0});
  await service.resolveClip(draft.id,'civitai.com',signal);
  assert.equal(service.state().clips.find(c=>c.id===draft.id).script_ready,true);
  assert.ok(calls.every(url=>url.startsWith('https://huggingface.co/')),'matching local video needs no Civitai API call');
  const initial=createSession(song,1);initial.min_rating=5;
  assert.throws(()=>arrange(initial,service.state().clips),/No usable clips/);
  initial.include_drafts=true;initial.output={preset:'landscape-720',fit:'contain'};
  const saved=await service.saveSession(arrange(initial,service.state().clips));
  const reopened=await new ComposerService(service.root).init(),loaded=await reopened.loadSession(saved.id);
  assert.equal(loaded.include_drafts,true);assert.equal(reopened.state().dataset.review_policy,'all-drafts');
  const prepared=await reopened.prepare(loaded);assert.equal(prepared.snapshot.warnings.length,1);
  const render=await reopened.render(loaded,signal);assert.deepEqual(await reopened.renderScripts(render.id),prepared.snapshot.scripts);
  const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(render.path),'manifest.json')));assert.equal(manifest.session.include_drafts,true);
  const disabled=await reopened.saveSession({...loaded,include_drafts:false});
  assert.equal((await reopened.loadSession(saved.id)).include_drafts,false);
  await assert.rejects(()=>reopened.prepare(disabled),/draft scripts are disabled/);
  await assert.rejects(()=>reopened.render(disabled,signal),/draft scripts are disabled/);
  assert.equal((await fs.readdir(path.join(service.root,'renders'))).length,1,'disabled draft use never starts a render');
  corrupt=true;await assert.rejects(()=>service.resolveClip(draft.id,'civitai.com',signal),/checksum mismatch/);corrupt=false;
  assert.equal(service.catalog.clips.find(c=>c.id===draft.id).review_status,'draft','resolving never approves a draft');
  review_status='approved';await service.refreshDataset();
  assert.equal(service.state().clips.find(c=>c.id===draft.id).review_status,'draft','all-drafts policy overrides stale approval labels');
  review_policy='folder-approval';await service.refreshDataset();assert.equal(service.state().clips.find(c=>c.id===draft.id).review_status,'approved');
  review_policy=undefined;review_status=undefined;await service.refreshDataset();
  assert.equal(service.state().clips.find(c=>c.id===draft.id).review_status,'draft','missing review labels are unreviewed');
  assert.equal(service.state().clips.find(c=>c.id===draft.id).audio_sync,false,'older snapshots are unmarked');
  audio_sync=true;service.catalog.clips=service.catalog.clips.filter(c=>c.origin!=='dataset');await service.refreshDataset();
  assert.equal(service.state().clips.find(c=>c.id===draft.id).audio_sync,true);
  assert.equal(service.state().clips.find(c=>c.id===draft.id).script_ready,false,'marked video can use song motion without fetching its stored scripts');
  const audioSession=createSession(song,1);audioSession.include_drafts=true;audioSession.output={preset:'landscape-720',fit:'contain'};
  audioSession.analysis={duration_ms:1000,bpm:120,confidence:1,waveform:Array(40).fill(1),beats:[],onsets:[]};
  const audioSaved=await service.saveSession(arrange(audioSession,service.state().clips.filter(c=>c.id===draft.id)));
  assert.equal(audioSaved.asset_bindings[draft.id].audio_sync,true);
  const restarted=await new ComposerService(service.root).init();assert.equal(restarted.state().clips.find(c=>c.id===draft.id).audio_sync,true);
  const audioPrepared=await restarted.prepare(await restarted.loadSession(audioSaved.id));
  assert.ok(audioPrepared.snapshot.blocks.every(b=>b.kind==='song'&&b.audio_sync));
  const audioRender=await restarted.render(audioSaved,signal);
  assert.deepEqual(await restarted.renderScripts(audioRender.id),audioPrepared.snapshot.scripts,'audio-sync preview and actual export use identical strokes');
  audio_sync=false;await service.refreshDataset();
  await assert.rejects(()=>service.prepare(audioSaved),/differs from the saved session/,'a changed motion source cannot silently alter a pinned recipe');
  assert.equal(service.state().clips.find(c=>c.id===draft.id).audio_sync,false);
  for(const invalid of ['true',1,null]){audio_sync=invalid;await assert.rejects(()=>service.refreshDataset(),/Invalid dataset audio sync/);}
});

test('dataset requires catalog checksum and rejects credential redirects',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-network-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const content=Buffer.from('');const commit='a'.repeat(40);
  let calls=[];
  const service=await new ComposerService(root,{fetchImpl:async(url,opts)=>{
    calls.push({url,opts});
    if(url.includes('/api/datasets/'))return new Response(JSON.stringify({sha:commit}));
    if(url.endsWith('manifest.json'))return new Response(JSON.stringify({schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':hash(content)}}));
    return new Response(content);
  }}).init();
  await service.refreshDataset();assert.equal(service.state().dataset.commit,commit);
  assert.ok(calls.slice(1).every(c=>c.url.includes(`/raw/${commit}/`)));
  service.fetch=async()=>new Response('',{status:302,headers:{location:'https://example.com/steal'}});
  await assert.rejects(()=>service.bytes('https://civitai.com/api/v1/images',{token:'test-secret'}),/redirected/);
  await assert.rejects(()=>service.bytes('http://127.0.0.1/private'),/Unsupported remote/);
  service.fetch=async url=>new Response(JSON.stringify(url.includes('/api/datasets/')?{sha:commit}:{schema:'s3f-public-funscripts/1',files:{'data/catalog.jsonl':'wrong'}}));
  await assert.rejects(()=>service.refreshDataset(),/checksum/);
});

test('job cancellation is observable and conflicting jobs are rejected',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-job-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const s=await new ComposerService(root).init();
  const job=s.startJob('wait',signal=>new Promise((resolve,reject)=>{signal.throwIfAborted();signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
  assert.throws(()=>s.startJob('other',async()=>{}),/current task/);s.cancel(job.id);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(s.job(job.id).state,'cancelled');
});
