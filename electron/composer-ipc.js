const { app, ipcMain, dialog, safeStorage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ComposerService } = require('./composer-service.cjs');
let servicePromise;
function binary(name){
  const suffix=process.platform==='win32'?'.exe':'';
  const dirs=[path.join(process.resourcesPath||'', 'backend'),path.join(path.dirname(app.getPath('exe')),'ffmpeg'),path.join(__dirname,'..',process.platform==='win32'?'ffmpeg':'ffmpeg-linux')];
  return dirs.map(d=>path.join(d,name+suffix)).find(p=>require('node:fs').existsSync(p))||name;
}
function service(){
  if(!servicePromise){const root=path.join(app.getPath('userData'),'composer');
    servicePromise=new ComposerService(root,{ffmpeg:binary('ffmpeg'),ffprobe:binary('ffprobe'),getToken:async()=>{
      if(process.env.CIVITAI_API_TOKEN)return process.env.CIVITAI_API_TOKEN;
      try{return safeStorage.decryptString(await fs.readFile(path.join(root,'civitai-key.enc')));}catch{return '';}
    }}).init();
  }return servicePromise;
}
function registerComposerIPC(){
  ipcMain.handle('composer',async(event,action,payload={})=>{
    const sender=new URL(event.senderFrame.url);if(sender.protocol!=='file:'||!sender.pathname.endsWith('/renderer/index.html'))throw new Error('Composer is available only in the main application.');
    const s=await service();
    switch(action){
      case 'state':return s.state();
      case 'song':{const result=await dialog.showOpenDialog({title:'Choose a song',properties:['openFile'],filters:[{name:'Audio',extensions:['wav','mp3','flac','m4a','ogg','opus','aac']}]});return result.canceled?null:s.startJob('song',(signal,update)=>s.importSong(result.filePaths[0],signal,update));}
      case 'scan':{const result=await dialog.showOpenDialog({title:'Choose a clip library',properties:['openDirectory']});return result.canceled?null:s.startJob('scan',(signal,update)=>s.scan(result.filePaths[0],signal,update));}
      case 'tag':return s.tag(payload.id,payload.category);
      case 'dataset':return s.startJob('dataset',(signal,update)=>s.refreshDataset(signal,update));
      case 'resolve':return s.startJob('resolve',(signal,update)=>s.resolveClip(payload.id,payload.site,signal,update));
      case 'job':return s.job(payload.id);
      case 'cancel':return s.cancel(payload.id);
      case 'sessions':return s.sessionList();
      case 'load':return s.loadSession(payload.id);
      case 'save':return s.saveSession(payload.session);
      case 'prepare':return s.prepare(payload.session);
      case 'render':return s.startJob('render',(signal,update)=>s.render(payload.session,signal,update));
      case 'render-scripts':return s.renderScripts(payload.id);
      case 'delete-render':return s.deleteRender(payload.id);
      case 'key':{
        const value=String(payload.value||'').trim();const file=path.join(s.root,'civitai-key.enc');
        if(!value){await fs.rm(file,{force:true});return {configured:false};}
        if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw new Error('System credential encryption is unavailable. Set CIVITAI_API_TOKEN when launching instead.');
        await fs.writeFile(file,safeStorage.encryptString(value),{mode:0o600});return {configured:true};}
      case 'export-folder':{
        if(!/^[a-f0-9-]{36}$/.test(payload.id))throw new Error('Invalid render ID.');
        return shell.openPath(path.join(s.root,'renders',payload.id));}
      default:throw new Error('Unknown Composer operation.');
    }
  });
}
module.exports={registerComposerIPC};
