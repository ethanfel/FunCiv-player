const fs=require('node:fs/promises');
const {createReadStream,createWriteStream}=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const yauzl=require('yauzl');
const archiver=require('archiver');
const {hashFile,digest}=require('./manga-service.cjs');
const open=file=>new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(e):resolve(z)));
const stream=(z,e)=>new Promise((resolve,reject)=>z.openReadStream(e,(err,s)=>err?reject(err):resolve(s)));
async function index(file){
  const zip=await open(file),entries=new Map();let total=0;
  try{await new Promise((resolve,reject)=>{
    zip.on('error',reject);zip.on('end',resolve);zip.on('entry',e=>{
      const n=e.fileName,mode=(e.externalFileAttributes>>>16)&0xf000;
      if(!/^(manga\.json|assets\/[a-f0-9]{64}\.[a-z0-9]+)$/.test(n)||entries.has(n)||mode===0xa000||!Number.isSafeInteger(e.uncompressedSize)||e.uncompressedSize>16*1024**3||entries.size>100000||(total+=e.uncompressedSize)>1024**4){reject(new Error('Invalid or oversized manga archive entry.'));return;}
      entries.set(n,e);zip.readEntry();
    });zip.readEntry();
  });return {zip,entries};}catch(e){zip.close();throw e;}
}
async function manifest(file,{base=null,allowPatch=false}={}){const {zip,entries}=await index(file);try{
  const entry=entries.get('manga.json');if(!entry||entry.uncompressedSize>16*1024**2)throw new Error('Missing or oversized manga manifest.');
  const chunks=[],input=await stream(zip,entry);await new Promise((resolve,reject)=>{input.on('data',b=>chunks.push(b));input.on('end',resolve);input.on('error',reject);});
  const raw=Buffer.concat(chunks).toString('utf8'),book=JSON.parse(raw);
  if(book.schema!=='funciv-manga/1'||book.minReaderVersion>3||!Array.isArray(book.pages)||book.pages.length>20000||!/^[-a-f0-9]{36}$/.test(book.id)||!book.assets)throw new Error('This manga needs a different reader version.');
  if(book.patchBase&&!allowPatch)throw new Error('Use Apply update on the matching portable book.');
  if(base&&(!book.patchBase||book.patchBase!==base.hash||book.id!==base.book.id))throw new Error('This update belongs to a different book edition.');
  for(const [id,a] of Object.entries(book.assets)){
    const inherited=base?.book.assets[id];
    if(!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(a.hash)||(!entries.has(a.path)&&!(book.patchBase&&allowPatch&&(!base||(inherited?.hash===a.hash&&inherited.size===a.size))))||(entries.has(a.path)&&entries.get(a.path).uncompressedSize!==a.size))throw new Error('Manga asset manifest does not match the archive.');
  }
  const {validateBook}=await import('../packages/manga-core/book.mjs');validateBook(book);return {book,hash:digest(raw),available:[...entries.keys()]};
}finally{zip.close();}}
async function openPackage(service,file){
  file=await fs.realpath(file);const {book,hash}=await manifest(file),stat=await fs.stat(file);
  for(const [id,a] of Object.entries(book.assets)){
    // IDs are content addresses and work across portable editions.
    service.assets.set(id,{id,archive:file,archiveMtime:stat.mtimeMs,entry:a.path,hash:a.hash,size:a.size,root:path.join(service.root,'cache')});
  }
  book.packageAssets=book.assets;delete book.assets;book.kind='package';book.manifestHash=hash;
  let source=service.state.sources.find(s=>s.id===book.id&&s.kind==='package');
  if(!source){source={id:book.id,kind:'package'};service.state.sources.push(source);}
  Object.assign(source,{source:file,title:book.title,opened:Date.now()});
  service.books.set(book.id,book);
  for(const update of source.updates||[])try{await applyUpdate(service,book.id,update,false);}catch(e){service.books.get(book.id).issues.push(`Update unavailable: ${e.message}`);break;}
  await service.save();return service.publicBook(service.books.get(book.id));
}
async function extract(service,asset){
  const stat=await fs.stat(asset.archive);if(stat.mtimeMs!==asset.archiveMtime)throw new Error('Manga package changed. Reopen it.');
  const target=path.join(service.root,'cache',asset.hash+path.extname(asset.entry));
  const cached=await fs.stat(target).catch(()=>null);
  if(cached?.size===asset.size&&(asset.verifiedMtime===cached.mtimeMs||await hashFile(target)===asset.hash)){asset.verifiedMtime=cached.mtimeMs;return target;}
  const {zip,entries}=await index(asset.archive),temp=target+'.'+randomUUID()+'.part';
  try{await fs.mkdir(path.dirname(target),{recursive:true});const entry=entries.get(asset.entry);if(!entry)throw new Error('Package asset is missing.');
    const hash=createHash('sha256');let size=0;
    await pipeline(await stream(zip,entry),new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>asset.size)return cb(new Error('Expanded asset exceeds its declared size.'));hash.update(chunk);cb(null,chunk);}}),createWriteStream(temp,{flags:'wx'}));
    if(size!==asset.size||hash.digest('hex')!==asset.hash)throw new Error('Manga asset checksum failed.');await fs.rename(temp,target);asset.verifiedMtime=(await fs.stat(target)).mtimeMs;return target;
  }finally{zip.close();await fs.rm(temp,{force:true});}
}
function references(book){const ids=new Set();for(const p of book.pages){if(p.image)ids.add(p.image);for(const panel of p.panels){for(const k of ['static','clean'])if(panel[k])ids.add(panel[k]);for(const t of panel.takes){for(const k of ['media','clean','baked','overlay','poster'])if(t[k])ids.add(t[k]);for(const row of t.bubbleLayers||[])ids.add(row.image);for(const id of Object.values(t.scripts||{}))ids.add(id);}}}return ids;}
function remap(book,mapping){for(const p of book.pages){p.image=mapping[p.image]||null;for(const panel of p.panels){for(const k of ['static','clean'])panel[k]=mapping[panel[k]]||null;for(const t of panel.takes){for(const k of ['media','clean','baked','overlay','poster'])t[k]=mapping[t[k]]||null;for(const row of t.bubbleLayers||[])row.image=mapping[row.image];for(const k of Object.keys(t.scripts||{}))t.scripts[k]=mapping[t.scripts[k]];}}}}
async function exportPackage(service,id,destination,options={},signal,update=()=>{}){
  const original=service.books.get(id);if(!original)throw new Error('Open the book first.');
  const book=structuredClone(original);delete book.kind;delete book.manifestHash;delete book.patchBase;delete book.packageAssets;
  const base=options.basePackage?await manifest(options.basePackage):null;if(base&&base.book.id!==id)throw new Error('Choose a previous package of this same book.');
  book.revision=randomUUID();book.minReaderVersion=1;book.presentation=service.state.readers[id]?.settings||{};book.overrides=service.state.readers[id]?.overrides||{};
  if(options.pageRange)book.pages=book.pages.slice(options.pageRange[0],options.pageRange[1]);
  const {selectedTake}=await import('../packages/manga-core/sequence.mjs');
  for(const p of book.pages){if(p.joinedOnly)book.minReaderVersion=3;for(const panel of p.panels){
    const selected=selectedTake(panel,book.overrides[panel.id])?.id||null;panel.selected=selected;
    if(book.overrides[panel.id]?.take)book.overrides[panel.id].take=selected;
    if(!options.alternates)panel.takes=panel.takes.filter(t=>t.id===selected);
    if(panel.joined)book.minReaderVersion=3;
    for(const t of panel.takes){if(t.bubbleLayers!==undefined)book.minReaderVersion=Math.max(2,book.minReaderVersion);if(t.clean&&(t.overlay||t.bubbleLayers!==undefined)&&!options.originalEncodes)t.baked=null;}
  }}
  for(const page of book.pages)for(const panel of page.panels)for(const take of panel.takes){signal?.throwIfAborted();Object.assign(take,await service.probe(await service.file(take.media)));}
  const ids=[...references(book)],mapping={},assets={},files=new Map();let count=0;
  for(const id of ids){signal?.throwIfAborted();const pinned=await service.pin(id),file=await service.file(pinned),hash=await hashFile(file),size=(await fs.stat(file)).size;
    const assetId=digest(hash+path.extname(file)),name=`assets/${hash}${path.extname(file).toLowerCase()}`;mapping[id]=assetId;assets[assetId]={path:name,hash,size};files.set(name,file);update(++count/Math.max(1,ids.length)*.7,`Collecting assets ${count}/${ids.length}`);
  }
  remap(book,mapping);book.assets=assets;
  if(base){book.patchBase=base.hash;const hashes=new Set(Object.values(base.book.assets).map(a=>a.hash));for(const [name] of files)if(hashes.has(path.basename(name).split('.')[0]))files.delete(name);}
  const temp=destination+'.'+randomUUID()+'.part',archive=archiver('zip',{forceZip64:true,store:true});
  const cancel=()=>archive.destroy(new Error('Export cancelled.'));signal?.addEventListener('abort',cancel,{once:true});
  try{
    const output=createWriteStream(temp,{flags:'wx'}),done=pipeline(archive,output);
    archive.append(JSON.stringify(book),{name:'manga.json'});for(const [name,file] of files)archive.file(file,{name});
    archive.on('progress',p=>update(.7+.25*p.entries.processed/(files.size+1),'Writing portable manga…'));
    await Promise.all([archive.finalize(),done]);signal?.throwIfAborted();await manifest(temp,{allowPatch:!!base,base});await fs.rename(temp,destination);return {path:destination,bytes:(await fs.stat(destination)).size};
  }finally{signal?.removeEventListener('abort',cancel);await fs.rm(temp,{force:true});}
}
async function applyUpdate(service,id,file,record=true){
  const current=service.books.get(id);if(current?.kind!=='package')throw new Error('Open the base portable book before applying its update.');
  const source=service.state.sources.find(s=>s.id===id&&s.kind==='package');
  const base={book:{...current,assets:current.packageAssets},hash:current.manifestHash};
  if(!base.book.assets){const original=await manifest(source.source);base.book.assets=original.book.assets;}
  const patch=await manifest(file,{allowPatch:true,base}),stat=await fs.stat(file),available=new Set(patch.available);
  const previous={book:structuredClone(current),assets:new Map([...references(current)].map(key=>[key,{...service.assets.get(key)}]))};
  for(const [key,a] of Object.entries(patch.book.assets))if(available.has(a.path))service.assets.set(key,{id:key,archive:file,archiveMtime:stat.mtimeMs,entry:a.path,hash:a.hash,size:a.size,root:path.join(service.root,'cache')});
  const book={...patch.book,packageAssets:patch.book.assets,kind:'package',manifestHash:patch.hash};delete book.assets;
  service.updateHistory||=new Map();service.updateHistory.set(id,previous);service.books.set(id,book);if(record){source.updates=[...(source.updates||[]),file];await service.save();}return service.publicBook(book);
}
async function rollbackUpdate(service,id){const previous=service.updateHistory?.get(id);if(!previous)throw new Error('No update to roll back in this session.');for(const [key,a] of previous.assets)service.assets.set(key,a);service.books.set(id,previous.book);service.updateHistory.delete(id);const source=service.state.sources.find(s=>s.id===id&&s.kind==='package');source.updates?.pop();await service.save();return service.publicBook(previous.book);}
module.exports={openPackage,extract,exportPackage,manifest,references,applyUpdate,rollbackUpdate};
