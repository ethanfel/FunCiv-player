// Keep the playing page and one upcoming page, sharing concurrent requests.
// A foreground replacement may retain its predecessor until it is ready.
class MangaRunCache {
  constructor(){this.entries=new Map();this.current=null;this.ahead=null;this.requested=null;this.queue=Promise.resolve();}
  wanted(key){return [this.current,this.ahead,this.requested].includes(key);}
  trim(){for(const [key,entry] of this.entries)if(!this.wanted(key)&&entry.done)this.entries.delete(key);}
  clearAhead(){this.ahead=null;this.trim();}
  get protectedFiles(){return new Set([...this.entries.values()].flatMap(e=>[...e.files]));}
  async get(key,build,prefetch=false){
    if(prefetch)this.ahead=key;else this.requested=key;
    let entry=this.entries.get(key);
    if(!entry){
      entry={files:new Set(),done:false};this.entries.set(key,entry);
      const check=()=>{if(!this.wanted(key))throw new Error('Page preparation was superseded.');};
      entry.promise=this.queue.catch(()=>{}).then(()=>{check();return build(entry.files,check);});
      this.queue=entry.promise.catch(()=>{});
      entry.promise=entry.promise.then(run=>{entry.done=true;return run;},error=>{entry.done=true;this.entries.delete(key);throw error;});
    }
    try{
      const run=await entry.promise;
      if(!prefetch&&this.requested===key){this.current=key;this.requested=null;if(this.ahead===key)this.ahead=null;}
      return run;
    }finally{this.trim();}
  }
}
module.exports={MangaRunCache};
