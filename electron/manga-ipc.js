const {app,ipcMain,dialog,protocol}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {Readable}=require('node:stream');
const {MangaService}=require('./manga-service.cjs');
let promise;
function binary(name){const executable=name+(process.platform==='win32'?'.exe':'');return [path.join(process.resourcesPath||'','backend',executable),path.join(path.dirname(app.getPath('exe')),'ffmpeg',executable),path.join(__dirname,'..',process.platform==='win32'?'ffmpeg':'ffmpeg-linux',executable)].find(p=>fs.existsSync(p))||name;}
function service(){return promise||=new MangaService(path.join(app.getPath('userData'),'manga'),{ffprobe:binary('ffprobe'),ffmpeg:binary('ffmpeg')}).init();}
function registerMangaIPC(){
  protocol.registerSchemesAsPrivileged([{scheme:'manga-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
  app.whenReady().then(()=>protocol.handle('manga-media',async request=>{
    try{const url=new URL(request.url);if(url.hostname!=='asset'||!/^\/[a-f0-9]{64}$/.test(url.pathname)||!['GET','HEAD'].includes(request.method))return new Response(null,{status:400});
      const s=await service(),file=await s.file(url.pathname.slice(1)),stat=await fs.promises.stat(file),range=request.headers.get('range');let start=0,end=stat.size-1,status=200;
      const headers={'Content-Type':({'.mp4':'video/mp4','.webm':'video/webm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.funscript':'application/json'})[path.extname(file).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'private, max-age=31536000, immutable','Access-Control-Allow-Origin':'*'};
      if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416});if(!m[1])start=Math.max(0,stat.size-Number(m[2]));else {start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}if(start>end||start>=stat.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${stat.size}`}});headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;status=206;}
      headers['Content-Length']=String(Math.max(0,end-start+1));return new Response(request.method==='HEAD'||stat.size===0?null:Readable.toWeb(fs.createReadStream(file,{start,end})),{status,headers});
    }catch{return new Response('Manga asset unavailable. Refresh or relink the book.',{status:404});}
  }));
  ipcMain.handle('manga',async(event,action,payload={})=>{
    const sender=new URL(event.senderFrame.url);if(sender.protocol!=='file:'||!sender.pathname.endsWith('/renderer/index.html')||event.senderFrame!==event.sender.mainFrame)throw new Error('Manga is available only in the main application.');
    const s=await service();switch(action){
      case 'list':return s.list();
      case 'changed':return s.changed(payload.id);
      case 'open':{const result=await dialog.showOpenDialog({title:'Open H3 Animator project',properties:['openDirectory']});return result.canceled?null:s.job('open',signal=>s.open(result.filePaths[0],signal));}
      case 'open-package':{const result=await dialog.showOpenDialog({title:'Open portable manga',properties:['openFile'],filters:[{name:'Manga',extensions:['fcmanga']}]});return result.canceled?null:s.job('open',()=>s.openPackage(result.filePaths[0]));}
      case 'reopen':return s.job('open',signal=>s.reopen(payload.id,signal));
      case 'save-reader':return s.saveReader(payload.id,payload.reader);
      case 'precache':return s.prepare(payload.id,payload.page,payload.settings,payload.overrides,true);
      case 'cancel-precache':s.runCache.clearAhead();return true;
      case 'prepare':return s.prepare(payload.id,payload.page,payload.settings,payload.overrides);
      case 'analyze-audio':return s.job('audio',signal=>s.analyzeAudio(payload.id,payload.panelId,payload.takeId,signal));
      case 'clean-cache':return s.cleanCache();
      case 'export':{const result=await dialog.showSaveDialog({title:'Export portable manga',defaultPath:(s.books.get(payload.id)?.title||'Manga')+'.fcmanga',filters:[{name:'Manga',extensions:['fcmanga']}]});return result.canceled?null:s.job('export',(signal,update)=>s.exportPackage(payload.id,result.filePath,payload.options,signal,update));}
      case 'export-update':{const base=await dialog.showOpenDialog({title:'Choose the base manga package',properties:['openFile'],filters:[{name:'Manga',extensions:['fcmanga']}]});if(base.canceled)return null;const out=await dialog.showSaveDialog({title:'Export script / presentation update',defaultPath:(s.books.get(payload.id)?.title||'Manga')+'.fcmanga-update',filters:[{name:'Manga update',extensions:['fcmanga-update']}]});return out.canceled?null:s.job('export-update',(signal,update)=>s.exportPackage(payload.id,out.filePath,{basePackage:base.filePaths[0]},signal,update));}
      case 'apply-update':{const result=await dialog.showOpenDialog({title:'Apply manga update',properties:['openFile'],filters:[{name:'Manga update',extensions:['fcmanga-update']}]});return result.canceled?null:s.job('update',()=>require('./manga-archive.cjs').applyUpdate(s,payload.id,result.filePaths[0]));}
      case 'rollback-update':return require('./manga-archive.cjs').rollbackUpdate(s,payload.id);
      case 'job':return s.jobState(payload.id);
      case 'cancel':return s.cancel(payload.id);
      default:throw new Error('Unknown manga operation.');
    }
  });
}
module.exports={registerMangaIPC,service};
