import { clipTagIndex, effectiveTagPreferences, tagKey, tagPreferenceLabel, MAX_PREFERRED_TAGS } from '../../packages/composer-core/tags.mjs';
import { clipRating, allowsClipReview, hasMotionForSection, matchesSection, videoIdentities } from '../../packages/composer-core/index.mjs';
import { clipMetadataIndex, matchesSourceFilters } from '../../packages/composer-core/source-metadata.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sectionTagLabel(session,section){
  const mode=section.tag_preferences?.mode||'inherit',prefs=effectiveTagPreferences(session,section),count=prefs.prefer.length+prefs.less.length;
  return mode==='off'?'Tags: off':`Tags: ${mode==='inherit'?'session':mode==='add'?'session + section':'section only'}${count?` · ${count}`:''}`;
}
export function tagChoices(clips,session,section){
  const identities=videoIdentities(clips),index=clipTagIndex(clips,identities),counts=new Map(),metadata=clipMetadataIndex(clips,identities);
  for(const clip of clips){
    if(clip.retired)continue;
    const key=identities.get(clip.id),eligible=clip.available===true&&clipRating(clip)>=(session.min_rating||0)&&allowsClipReview(session,clip)&&
      (section?[section]:session.sections).some(s=>matchesSection(clip,s)&&hasMotionForSection(clip,s)&&matchesSourceFilters(clip,session,s,metadata));
    for(const tag of index.get(clip.id)){
      if(!counts.has(tag))counts.set(tag,{tag,all:new Set(),pool:new Set()});
      counts.get(tag).all.add(key);if(eligible)counts.get(tag).pool.add(key);
    }
  }
  return [...counts.values()].map(c=>({tag:c.tag,total:c.all.size,pool:c.pool.size})).sort((a,b)=>b.pool-a.pool||b.total-a.total||a.tag.localeCompare(b.tag));
}

export function openTagPicker(view,sectionId=null){
  const session=view.session,section=sectionId&&session?.sections.find(s=>s.id===sectionId);
  if(!session||sectionId&&!section)throw new Error('Load a song and select a section first.');
  const original=section?section.tag_preferences:session.tag_preferences;
  const selected={prefer:new Set(original?.prefer||[]),less:new Set(original?.less||[])};
  const rows=tagChoices(view.catalog.clips,session,section),counts=new Map(rows.map(r=>[r.tag,r]));
  let mode=section?original?.mode||'inherit':null;
  const document=view.root.ownerDocument,dialog=document.createElement('dialog');dialog.className='fc-dialog fc-tag-dialog';
  dialog.setAttribute('aria-labelledby','fc-tag-title');
  dialog.innerHTML=`<form method="dialog">
    <header><span class="fc-eyebrow">CLIP SELECTION</span><h2 id="fc-tag-title">Tag preferences · ${esc(section?.label||'Session')}</h2>
      <p>Star ratings come first. Tags guide the choice between equally rated clips.</p>
    </header>
    <div class="fc-tag-body">
      ${section?`<label class="fc-tag-mode">This section<select name="tag-mode"><option value="inherit">Use session preferences</option><option value="add">Add to session preferences</option><option value="replace">Use only section preferences</option><option value="off">Ignore tags for this section</option></select></label>`:'<p class="fc-tag-scope">These defaults apply to sections that use session preferences.</p>'}
      <div class="fc-tag-inherited" hidden></div>
    <div class="fc-tag-selected"><section><h3>Prefer <small>more often</small></h3><div data-tag-selected="prefer"></div></section><section><h3>Less often <small>still eligible</small></h3><div data-tag-selected="less"></div></section></div>
    <label class="fc-tag-search">Search published tags<input name="tag-search" type="search" placeholder="Search tags…" autocomplete="off"></label>
    <div class="fc-tag-results-heading"><span data-tag-results-count></span><span>In pool / library · unique videos</span></div>
    <div class="fc-tag-results" aria-label="Available tags"></div>
    </div>
    <footer><p class="fc-tag-dialog-status" role="status"></p><small>Pool counts respect folders, categories, ratings, drafts and readiness; clip length can reduce the choices further. Less often is a preference, not an exclusion. Existing clips change only when you assemble, replace a clip or remake a section.</small>
      <div class="fc-actions"><button type="button" name="clear-tags">Clear choices</button><span class="fc-spacer"></span><button value="cancel">Cancel</button><button value="apply" class="fc-primary">Apply preferences</button></div>
    </footer>
  </form>`;
  const $=selector=>dialog.querySelector(selector);
  const preferences=()=>({prefer:[...selected.prefer].sort(),less:[...selected.less].sort()});
  const status=text=>{$('.fc-tag-dialog-status').textContent=text;};
  function render(){
    if(section)$('[name=tag-mode]').value=mode;
    const inherited=section&&['inherit','add'].includes(mode)?session.tag_preferences:null;
    $('.fc-tag-inherited').hidden=!inherited||!inherited.prefer.length&&!inherited.less.length;
    $('.fc-tag-inherited').innerHTML=inherited?`<strong>Session defaults</strong>${['prefer','less'].map(key=>inherited[key].length?`<span>${key==='prefer'?'Prefer':'Less often'}: ${inherited[key].map(esc).join(', ')}</span>`:'').join('')}`:'';
    for(const key of ['prefer','less'])$(`[data-tag-selected=${key}]`).innerHTML=[...selected[key]].sort().map(tag=>`<button type="button" data-remove-tag="${esc(tag)}" data-list="${key}" aria-label="Remove ${esc(tag)} from ${key==='prefer'?'preferred':'less often'} tags" title="${counts.get(tag)?.pool||0} in pool / ${counts.get(tag)?.total||0} library videos">${esc(tag)} <span aria-hidden="true">×</span></button>`).join('')||'<small>No tags selected</small>';
    const query=tagKey($('[name=tag-search]').value),matching=rows.filter(r=>r.tag.includes(query)),visible=matching.slice(0,80);
    $('[data-tag-results-count]').textContent=`${matching.length} matching tags${matching.length>80?' · showing 80, refine your search':''}`;
    const scroll=$('.fc-tag-results').scrollTop;
    $('.fc-tag-results').innerHTML=visible.map(row=>`<div class="fc-tag-result" data-tag="${esc(row.tag)}"><span>${esc(row.tag)}</span><small>${row.pool} / ${row.total}</small><div>${['prefer','less'].map(key=>`<button type="button" data-tag-choice="${esc(row.tag)}" data-list="${key}" aria-pressed="${selected[key].has(row.tag)}" aria-label="${key==='prefer'?'Prefer':'Use less often'}: ${esc(row.tag)}">${key==='prefer'?'Prefer':'Less often'}</button>`).join('')}</div></div>`).join('')||`<p>${rows.length?'No matching tags. Try another search.':'No published tags yet. Close this picker and use Sync FunCiv Data.'}</p>`;
    $('.fc-tag-results').scrollTop=scroll;
    status(section&&mode==='inherit'?'Using session defaults. Choosing a tag adds a section preference.':section&&mode==='off'?'Tag preferences are ignored for this section. Choosing a tag enables section preferences.':`${tagPreferenceLabel(preferences())}. Each tag has equal weight; “Less often” subtracts from the match score.`);
  }
  dialog.addEventListener('input',event=>{if(event.target.name==='tag-search'){$('.fc-tag-results').scrollTop=0;render();}});
  dialog.addEventListener('change',event=>{if(event.target.name==='tag-mode'){mode=event.target.value;render();}});
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'&&event.target.type==='search')event.preventDefault();});
  dialog.addEventListener('click',event=>{
    const choice=event.target.closest('[data-tag-choice]'),remove=event.target.closest('[data-remove-tag]');
    if(choice){
      const tag=choice.dataset.tagChoice,list=choice.dataset.list,other=list==='prefer'?'less':'prefer';
      if(selected[list].has(tag))selected[list].delete(tag);
      else{if(selected[list].size>=MAX_PREFERRED_TAGS){status(`Choose at most ${MAX_PREFERRED_TAGS} tags per preference list.`);return;}selected[other].delete(tag);selected[list].add(tag);}
      if(section&&['inherit','off'].includes(mode))mode='add';render();
      [...dialog.querySelectorAll('[data-tag-choice]')].find(el=>el.dataset.tagChoice===tag&&el.dataset.list===list)?.focus({preventScroll:true});
    }
    if(remove){selected[remove.dataset.list].delete(remove.dataset.removeTag);render();}
  });
  $('[name=clear-tags]').addEventListener('click',()=>{selected.prefer.clear();selected.less.clear();render();});
  dialog.addEventListener('close',()=>{
    dialog.remove();if(dialog.returnValue!=='apply')return;
    try{
      if(view.session!==session)throw new Error('The session changed. Open tag preferences again.');
      const prefs=preferences(),value=section?mode==='inherit'?undefined:{mode,...prefs}:prefs.prefer.length||prefs.less.length?prefs:undefined;
      if(JSON.stringify(value)===JSON.stringify(original))return;
      view.edit(next=>{const owner=section?next.sections.find(s=>s.id===section.id):next;if(value)owner.tag_preferences=value;else delete owner.tag_preferences;},{keepPlacements:true,affectsPlayback:false});
      view.message('Tag preferences saved in the recipe. Assemble, replace a clip or remake a section to use them. Current clips stay in place.');
    }catch(error){view.message(error.message,true);}
  });
  render();view.root.append(dialog);dialog.showModal();$('[name=tag-search]').focus();
}
