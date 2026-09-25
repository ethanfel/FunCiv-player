import {presentation} from './motion.mjs';
import {validateBubbleLayers} from './bubbles.mjs';
export function validateBook(book){
  if(book.schema!=='funciv-manga/1'||!Array.isArray(book.pages)||book.pages.length>20000||!['ltr','rtl','vertical'].includes(book.direction))throw new Error('Unsupported manga structure or reading direction.');
  if(book.presentation)presentation(book.presentation);
  const pages=new Set(),panels=new Set(),asset=id=>{if(id!=null&&(typeof id!=='string'||!Object.hasOwn(book.assets,id)))throw new Error('A panel references an undeclared asset.');};
  for(const p of book.pages){
    if(typeof p.id!=='string'||pages.has(p.id)||!Number.isFinite(p.width)||p.width<=0||!Number.isFinite(p.height)||p.height<=0||!Array.isArray(p.panels)||p.panels.length>10000)throw new Error('Invalid manga page.');pages.add(p.id);asset(p.image);
    if(p.joinedOnly!==undefined&&(typeof p.joinedOnly!=='boolean'||p.joinedOnly&&p.panels.length))throw new Error('Invalid joined endpoint page.');
    for(const panel of p.panels){
      if(typeof panel.id!=='string'||['__proto__','constructor','prototype'].includes(panel.id)||panels.has(panel.id)||!Array.isArray(panel.bbox)||panel.bbox.length!==4||panel.bbox.some(n=>!Number.isFinite(n)||n<0||n>1)||panel.bbox[2]<=panel.bbox[0]||panel.bbox[3]<=panel.bbox[1]||!Array.isArray(panel.takes))throw new Error('Invalid manga panel.');panels.add(panel.id);
      if(panel.polygon&&(!Array.isArray(panel.polygon)||panel.polygon.length<3||panel.polygon.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||n<0||n>1))))throw new Error('Invalid panel polygon.');
      asset(panel.static);asset(panel.clean);const takes=new Set();
      if(panel.joined){const j=panel.joined;if(!/^flf_[a-f0-9]{16}$/.test(j.variant)||typeof j.label!=='string'||!Array.isArray(j.sourcePanelIds)||j.sourcePanelIds.length!==2||j.sourcePanelIds.some(id=>typeof id!=='string'||!id)||j.sourcePanelIds[0]!==panel.sourceId||j.sourcePanelIds[0]===j.sourcePanelIds[1]||panel.takes.some(t=>t.flfVariant!==j.variant))throw new Error('Invalid joined-panel sequence or take.');}
      for(const t of panel.takes){if(typeof t.id!=='string'||takes.has(t.id)||!Number.isFinite(t.durationMs)||t.durationMs<=0)throw new Error('Invalid animation take.');takes.add(t.id);for(const k of ['media','clean','baked','overlay','poster'])asset(t[k]);if(t.bubbleLayers!==undefined){if(!t.clean||t.media!==t.clean)throw new Error('Timed bubble layers require clean video.');validateBubbleLayers(t.bubbleLayers,asset);}for(const [axis,id] of Object.entries(t.scripts||{})){if(!['L0','L1','L2','R0','R1','R2'].includes(axis))throw new Error('Unsupported motion axis.');asset(id);}}
    }
  }
  for(const value of Object.values(book.overrides||{}))presentation({...book.presentation,...value});
  return book;
}
