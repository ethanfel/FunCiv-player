import { SOURCE_FACETS, sourceKey, sourceValues, clipMetadataIndex, matchesSourceFilters, sourceFilterCount, validateSourceFilters } from '../../packages/composer-core/source-metadata.mjs';
import { videoIdentities, clipRating, allowsClipReview, matchesSection, hasMotionForSection } from '../../packages/composer-core/index.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const display=(field,value)=>value?(field==='orientations'?value[0].toUpperCase()+value.slice(1):value):`Unknown ${field==='creators'?'creator':field==='base_models'?'model':field==='content_ratings'?'rating':'orientation'}`;
export function sourceFilterLabel(session,section){
  const local=section.source_filters,mode=local?.mode||'inherit',count=sourceFilterCount(local)+(mode==='replace'||mode==='off'?0:sourceFilterCount(session.source_filters));
  return `Sources: ${mode==='off'?'any':mode==='inherit'?'session':mode==='replace'?'section':'narrowed'}${count&&mode!=='off'?' · '+count:''}`;
}
export function sourceChoices(clips,index=clipMetadataIndex(clips)){
  const identities=videoIdentities(clips),facets=Object.fromEntries(Object.keys(SOURCE_FACETS).map(f=>[f,new Map()]));
  for(const clip of clips){if(clip.retired)continue;const values=sourceValues(clip,index);
    for(const field of Object.keys(facets)){
      const key=sourceKey(values[field]),map=facets[field];if(!map.has(key))map.set(key,{key,label:display(field,values[field]),videos:new Set()});
      map.get(key).videos.add(identities.get(clip.id));
    }
  }
  return Object.fromEntries(Object.entries(facets).map(([field,rows])=>[field,[...rows.values()].map(({key,label,videos})=>({key,label,count:videos.size})).sort((a,b)=>Number(!a.key)-Number(!b.key)||a.label.localeCompare(b.label))]));
}
export function openSourceFilters(view,target='session',sectionId){
  const originalSession=view.session,section=target==='section'&&originalSession?.sections.find(s=>s.id===sectionId),library=target==='library';
  if(!library&&(!originalSession||target==='section'&&!section))throw new Error('Load a song and select a section first.');
  const original=library?view.librarySourceFilters:section?section.source_filters:originalSession.source_filters;
  const selected=Object.fromEntries(Object.keys(SOURCE_FACETS).map(field=>[field,new Set(original?.[field]||[])]));
  let minimum=original?.min_short_edge||0,mode=section?original?.mode||'inherit':null;
  const clips=view.catalog.clips,index=clipMetadataIndex(clips),identities=videoIdentities(clips),choices=sourceChoices(clips,index);
  for(const field of Object.keys(selected))for(const key of selected[field])if(!choices[field].some(row=>row.key===key))choices[field].push({key,label:display(field,key),count:0});
  const doc=view.root.ownerDocument,dialog=doc.createElement('dialog');dialog.className='fc-dialog fc-source-dialog';dialog.setAttribute('aria-labelledby','fc-source-title');
  dialog.innerHTML=`<form method="dialog"><header><span class="fc-eyebrow">${library?'CLIP LIBRARY':'CLIP SELECTION'}</span><h2 id="fc-source-title">${library?'Browse source metadata':`Source filters · ${esc(section?.label||'Session')}`}</h2>
    <p>${library?'Filter library results. These browsing choices do not change the recipe.':'Limit new clip choices to matching sources. Star ratings and tag preferences rank the matches.'}</p></header>
    <div class="fc-source-body">
    ${section?'<label class="fc-source-mode">This section<select name="source-mode"><option value="inherit">Use session filters</option><option value="narrow">Narrow the session filters</option><option value="replace">Use only section filters</option><option value="off">Any source in this section</option></select></label><div class="fc-source-defaults"></div>':''}
    <div class="fc-source-columns"><section class="fc-source-creators"><div class="fc-panel-heading"><h3>Creators <small data-creator-count></small></h3><button type="button" data-clear-facet="creators">Any creator</button></div>
      <label>Find a creator<input name="creator-search" type="search" placeholder="Search usernames…" autocomplete="off"></label><div class="fc-source-picked"></div><div class="fc-source-creator-list" aria-label="Creators"></div></section>
    <section class="fc-source-other">${['base_models','content_ratings','orientations'].map(field=>`<fieldset><legend>${SOURCE_FACETS[field]}</legend><div data-source-facet="${field}"></div><button type="button" data-clear-facet="${field}">Any ${field==='base_models'?'model':field==='content_ratings'?'rating':'orientation'}</button></fieldset>`).join('')}
      <label>Minimum source short edge (pixels)<input name="source-resolution" type="number" min="0" max="100000" step="1" value="${minimum}"></label><small>0 means any size. 1080 requires both source dimensions to be at least 1080 px. Output framing is set separately.</small>
    </section></div></div>
    <footer><p class="fc-source-status" role="status"></p><small>${library?'Counts combine linked records of the same video.':'Choose any of the selected values within a field; different fields must all match. Missing metadata matches only Any or Unknown. Current clips stay in place until you assemble or replace them; unlock kept clips outside the filters.'}</small>
    <div class="fc-actions"><button type="button" name="source-clear">Clear choices</button><span class="fc-spacer"></span><button value="cancel">Cancel</button><button value="apply" class="fc-primary">Apply filters</button></div></footer></form>`;
  const $=q=>dialog.querySelector(q),value=()=>({...Object.fromEntries(Object.entries(selected).map(([k,set])=>[k,[...set].sort()])),min_short_edge:minimum});
  const enable=()=>{if(section&&['inherit','off'].includes(mode))mode='narrow';};
  function render(){
    if(section){
      $('[name=source-mode]').value=mode;
      const defaults=originalSession.source_filters,labels=Object.entries(SOURCE_FACETS).flatMap(([field,label])=>defaults?.[field]?.length?[`${label}: ${defaults[field].map(v=>choices[field].find(c=>c.key===v)?.label||display(field,v)).join(', ')}`]:[]);
      if(defaults?.min_short_edge)labels.push(`Minimum short edge: ${defaults.min_short_edge} px`);
      $('.fc-source-defaults').textContent=`Session defaults · ${labels.join(' · ')||'Any source'}`;
      $('.fc-source-defaults').hidden=!['inherit','narrow'].includes(mode);
    }
    $('[data-creator-count]').textContent=selected.creators.size?`${selected.creators.size} selected`:'any';
    $('.fc-source-picked').innerHTML=[...selected.creators].map(key=>`<button type="button" data-remove-creator="${esc(key)}" aria-label="Remove creator ${esc(display('creators',key))}">${esc(choices.creators.find(c=>c.key===key)?.label||display('creators',key))} ×</button>`).join('');
    const query=sourceKey($('[name=creator-search]').value);
    for(const [field,rows] of Object.entries(choices)){
      const holder=field==='creators'?$('.fc-source-creator-list'):$(`[data-source-facet=${field}]`),scroll=holder.scrollTop;
      holder.innerHTML=rows.filter(row=>field!=='creators'||sourceKey(row.label).includes(query)).map(row=>`<label class="fc-source-choice"><input type="checkbox" data-source-field="${field}" value="${esc(row.key)}" ${selected[field].has(row.key)?'checked':''}><span>${esc(row.label)}</span><small title="Unique videos in the library">${row.count}</small></label>`).join('')||'<p>No matching metadata. Sync FunCiv Data to refresh it.</p>';
      holder.scrollTop=scroll;
    }
    const session=originalSession||{sections:[{motion:'hold'}],min_rating:view.minimumRating(),include_drafts:view.includeDrafts},draft={...session};
    let scopes=section?[{...section,source_filters:mode==='inherit'?undefined:{mode,...value()}}]:session.sections;
    if(library){draft.source_filters=value();scopes=[{motion:'hold'}];}else if(!section)draft.source_filters=sourceFilterCount(value())?value():undefined;
    const matching=new Set(),ready=new Set();
    for(const clip of clips){
      if(clip.retired||!allowsClipReview(draft,clip)||clipRating(clip)<(draft.min_rating||0))continue;
      const sections=scopes.filter(s=>(library||matchesSection(clip,s))&&matchesSourceFilters(clip,draft,s,index));
      if(!sections.length)continue;matching.add(identities.get(clip.id));
      if(clip.available&&sections.some(s=>hasMotionForSection(clip,s)))ready.add(identities.get(clip.id));
    }
    const prefix=section&&mode==='inherit'?'Using session filters. ':section&&mode==='off'?'Source restrictions disabled for this section. ':'';
    $('.fc-source-status').textContent=`${prefix}${matching.size} matching video${matching.size===1?'':'s'} · ${ready.size} ${library?'locally available':'ready before clip-length and no-repeat checks'}.${matching.size?'':' Broaden the choices or sync more metadata.'}`;
  }
  dialog.addEventListener('input',event=>{if(event.target.name==='creator-search')render();});
  dialog.addEventListener('change',event=>{
    const el=event.target,field=el.dataset.sourceField;
    if(field){if(el.checked&&selected[field].size>=128){el.checked=false;$('.fc-source-status').textContent='Choose at most 128 values per field.';return;}el.checked?selected[field].add(el.value):selected[field].delete(el.value);enable();}
    if(el.name==='source-mode')mode=el.value;
    if(el.name==='source-resolution'){minimum=Number(el.value);enable();}
    render();if(field)[...dialog.querySelectorAll('[data-source-field]')].find(e=>e.dataset.sourceField===field&&e.value===el.value)?.focus({preventScroll:true});
  });
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.clearFacet){selected[button.dataset.clearFacet].clear();enable();render();}
    if(button.hasAttribute('data-remove-creator')){selected.creators.delete(button.dataset.removeCreator);enable();render();}
    if(button.name==='source-clear'){Object.values(selected).forEach(set=>set.clear());minimum=0;$('[name=source-resolution]').value=0;render();}
  });
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'&&event.target.type==='search')event.preventDefault();});
  dialog.addEventListener('close',()=>{
    dialog.remove();if(dialog.returnValue!=='apply')return;
    try{
      const filters=value();
      validateSourceFilters(filters);
      if(library){view.librarySourceFilters=sourceFilterCount(filters)?filters:undefined;view.renderLibrary();return;}
      if(view.session!==originalSession)throw new Error('The session changed. Open source filters again.');
      const next=section?(mode==='inherit'?undefined:{mode,...filters}):sourceFilterCount(filters)?filters:undefined;
      if(JSON.stringify(next)===JSON.stringify(original))return;
      view.edit(s=>{const owner=section?s.sections.find(v=>v.id===section.id):s;if(next)owner.source_filters=next;else delete owner.source_filters;},{keepPlacements:true,affectsPlayback:false});
      view.message('Source filters saved in the recipe. Assemble, replace a clip or remake a section to apply them. Current clips and playback stay in place.');
    }catch(error){view.message(error.message,true);}
  });
  render();view.root.append(dialog);dialog.showModal();$('[name=creator-search]').focus();
}

export function sourceMetadataHTML(clip,index){
  const record=index?.get(clip.id)||clip,meta=record.civitai_metadata||{},values=sourceValues(clip,index);
  const entries=[['Creator',record.creator_username],['Source model',meta.base_model],['Civitai rating',meta.content_rating],
    ['Source size',meta.width&&meta.height?`${meta.width} × ${meta.height} · ${display('orientations',values.orientations)}`:clip.width&&clip.height?`${clip.width} × ${clip.height}`:null],
    ['Published',meta.created_at?.slice(0,10)],['Post',record.post_id],['Model versions',meta.model_version_ids?.join(', ')],
    ['Reactions',meta.stats?`${meta.stats.likeCount??0} likes · ${meta.stats.heartCount??0} hearts`:null]];
  return `<details class="fc-source-details"><summary>Civitai source${record.creator_username?' · '+esc(record.creator_username):''}</summary><dl>${entries.filter(([,value])=>value).map(([key,value])=>`<dt>${key}</dt><dd>${esc(value)}</dd>`).join('')||'<dd>No published source metadata. Sync FunCiv Data to refresh it.</dd>'}</dl><small>Civitai content ratings and reactions are separate from the clip’s star rating. Source metadata does not change output framing.</small></details>`;
}
