import { clipRating, isDraftClip, isAudioSyncClip } from '../../packages/composer-core/index.mjs';
import { libraryVideoLabel } from './clip-readiness.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=ms=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(1).padStart(4,'0')}`;
const stars=n=>n?`${n}★`:'Unrated';
const ready=c=>c.available&&(c.script_ready||isAudioSyncClip(c));

export class ClipLibrary {
  constructor(view){this.view=view;this.selected=null;}
  select(id){this.selected=id;this.view.renderLibrary();}
  render(clips,used,minimum,empty){
    const v=this.view,list=v.root.querySelector('.fc-clips'),scroll=list.scrollTop;
    if(!clips.some(c=>c.id===this.selected))this.selected=clips[0]?.id;
    list.innerHTML=clips.map(c=>{
      const rating=clipRating(c),status=libraryVideoLabel(c);
      return `<article class="fc-clip ${c.id===this.selected?'fc-selected':''}" data-clip-id="${esc(c.id)}" data-rating="${rating}"><button class="fc-clip-row" data-action="inspect-library-clip" data-id="${esc(c.id)}" aria-pressed="${c.id===this.selected}" title="${esc(c.name)}"><span class="fc-clip-heading"><strong>${esc(c.name)}</strong><time>${stamp(c.duration_ms)}</time></span><span class="fc-clip-meta"><span class="fc-clip-stars">${stars(rating)}</span><span class="fc-availability ${ready(c)?'fc-ready':''}">${status}</span>${isDraftClip(c)?'<span class="fc-draft-badge">Draft</span>':''}${used.has(c.id)?`<span>Used ${used.get(c.id)}×</span>`:''}</span><span class="fc-clip-footer"><span class="fc-clip-category">${esc((c.categories||[]).join(', ')||'Uncategorized')}${rating<minimum?' · Below minimum':''}${!v.includeDrafts&&isDraftClip(c)?' · Draft excluded':''}</span>${isAudioSyncClip(c)?'<span class="fc-audio-sync-badge">Audio sync</span>':''}</span></button></article>`;
    }).join('')||`<p class="fc-empty">${esc(empty)}</p>`;
    list.scrollTop=scroll;
    const clip=clips.find(c=>c.id===this.selected),details=v.root.querySelector('.fc-clip-details');details.hidden=!clip;if(!clip){details.innerHTML='';return;}
    const rating=clipRating(clip),override=clip.user_rating!==undefined;
    const choices=[['',clip.origin==='dataset'?`Dataset rating (${stars(clipRating({quality:clip.quality}))})`:'No local rating'],...Array.from({length:6},(_,n)=>[String(n),stars(n)])];
    details.innerHTML=`<div class="fc-panel-heading"><h3>Selected clip</h3><span>${isDraftClip(clip)?'Draft · unreviewed':esc(clip.review_status||'Local')}</span></div><strong class="fc-detail-title">${esc(clip.name)}</strong>
      <div class="fc-file-status"><strong>${clip.available?'Local video linked':clip.path?'Local video unavailable':'Video not linked'}</strong><small>${clip.path?esc(clip.path):'Already on disk? Index its folder with ＋ Folder.'}</small><small>${clip.script_ready?'Motion scripts ready':isAudioSyncClip(clip)?'Uses song motion':clip.remote_scripts?.L0?'Scripts published on HF · not loaded locally':'No L0 motion script available'}</small></div>
      ${isAudioSyncClip(clip)?'<p class="fc-audio-sync-note">Audio sync · uses song-generated strokes during its video region. Analyze the song first. Neutral hold overrides this.</p>':''}
      <div class="fc-detail-fields"><label>Your rating<select data-field="rating" data-id="${esc(clip.id)}" aria-label="Rating for ${esc(clip.name)}">${choices.map(([value,label])=>`<option value="${value}" ${value===(override?String(clip.user_rating):'')?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label>Folder / category<input data-field="tag" data-id="${esc(clip.id)}" value="${esc(clip.categories?.[0]||'Uncategorized')}"></label></div>
      ${clip.origin==='dataset'?`<div class="fc-imported-categories"><small>HF categories: ${esc(clip.dataset_categories?.join(', ')||'None published')}</small>${clip.category_paths?.length?`<small>HF folders: ${esc(clip.category_paths.join(', '))}</small>`:''}${clip.manual_categories?`<button data-action="reset-category" data-id="${esc(clip.id)}">Use imported categories</button>`:''}</div>`:''}
      <small>${override?'Your rating':clip.origin==='dataset'?'Dataset rating':'Rating'}: ${stars(rating)}${clip.script_ready?' · Motion: '+esc((clip.axes||[]).join(' / ')):''}</small>
      ${clip.origin==='dataset'?`<button data-action="${clip.available&&!ready(clip)?'fetch-scripts':'resolve'}" data-id="${esc(clip.id)}" class="${ready(clip)?'':'fc-primary'}">${ready(clip)?'Verify / refresh':clip.available?'Get HF scripts':'Download video + scripts'}</button>`:''}`;
  }
}
