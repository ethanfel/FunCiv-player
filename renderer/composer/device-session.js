import { clampRawScriptContent, extendRawScriptContent } from '../js/device-transform-stack.js';

// Reuse FunSync's configured transports and output transforms. The source mutex
// releases this binding before VR / Web Remote can start using the same engines.
export class ComposerDeviceSession {
  constructor(app,{owner='composer'}={}){
    this.app=app;this.owner=owner;this.generation=0;this.active=false;
    // Serialise uploads across all owners of a cloud transport. A superseded
    // upload finishes before the incoming source's upload can replace it.
    for(const [manager,method] of [[app.handyManager,'uploadAndSetScript'],[app.autoblowManager,'uploadScript']]){
      if(!manager?.[method]||manager._composerUploadQueue)continue;
      const original=manager[method].bind(manager);let queue=Promise.resolve();
      manager[method]=(...args)=>{queue=queue.catch(()=>{}).then(()=>original(...args));return queue;};
      manager._composerUploadQueue=true;
    }
  }
  engines(){const a=this.app;return [a.syncEngine,a.buttplugSync,a.tcodeSync,a.autoblowSync].filter(Boolean);}
  async arm(snapshot,player){
    this.release();const a=this.app,gen=++this.generation;
    const connected=a.handyManager?.connected||a.buttplugManager?.connected||a.tcodeManager?.connected||a.autoblowManager?.connected;
    if(!connected)throw new Error('Connect a device with the Devices button, then prepare device sync.');
    a.sessionTracker?.startSession(this.owner,snapshot.session_id);
    this.active=true;a.videoPlayer.pause();a._clearMiniplayer();a.handyHdspSync?.stop();
    a._resetCustomRoutingState?.();
    this.engines().forEach(e=>{if(e._active)e.stop();e.player=player;});
    this.fillerOptions=a.funscriptEngine._fillerOptions;
    a.funscriptEngine.setFillerOptions(null);
    const content=JSON.stringify(snapshot.scripts.L0);
    const cloudContent=key=>clampRawScriptContent(extendRawScriptContent(content,!!a.settings?.get?.('player.rangeExtender.enabled')),a._cutoffFromSettings?.(key));
    try{
      await a.funscriptEngine.loadContent(content,this.owner+'.funscript');
      if(gen!==this.generation)return false;
      a.buttplugSync?.clearAxisActions();a.buttplugSync?.setVibrationActions(null);a.tcodeSync?.clearAxisActions();
      for(const [axis,script] of Object.entries(snapshot.scripts))if(axis!=='L0'){
        a.buttplugSync?.setAxisActions(axis,script.actions);a.tcodeSync?.setAxisActions(axis,script.actions);
      }
      if(a.handyManager?.connected){
        const ok=await a.handyManager.uploadAndSetScript(cloudContent('handy'));
        if(gen!==this.generation)return false;
        if(ok===false)throw new Error('Handy script upload failed.');
        a.syncEngine._scriptReady=true;a.syncEngine.start();
      }
      if(a.autoblowManager?.connected){
        const ok=await a.autoblowSync.uploadScript(cloudContent('autoblow'));
        if(gen!==this.generation)return false;
        if(!ok)throw new Error('Autoblow script upload failed.');a.autoblowSync.start();
      }
      if(a.buttplugManager?.connected){a.buttplugSync.reloadActions();a.buttplugSync.start();}
      if(a.tcodeManager?.connected){a.tcodeSync.reloadActions();a.tcodeSync.start();}
      a.sessionTracker?.setVideo({name:snapshot.song.name,videoId:snapshot.session_id,duration:snapshot.duration_ms/1000});
      a.sessionTracker?.markScriptReady(snapshot.scripts.L0.actions.length);
      return true;
    }catch(e){if(gen===this.generation)this.release();throw e;}
  }
  release(){
    this.generation++;if(!this.active)return;this.active=false;const a=this.app;
    this.engines().forEach(e=>{e.player.video.pause?.();if(e._active)e.stop();e.player=a.videoPlayer;});
    if(a.handyManager?.connected)Promise.resolve(a.handyManager.hsspStop()).catch(()=>{});
    a.buttplugSync?.clearAxisActions();a.tcodeSync?.clearAxisActions();
    if(a.syncEngine)a.syncEngine._scriptReady=false;
    a.funscriptEngine.clear();
    a.funscriptEngine.setFillerOptions(this.fillerOptions);
    if(a.sessionTracker?.getSession()?.source===this.owner)a.sessionTracker.endSession();
  }
}
