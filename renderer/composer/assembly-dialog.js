import { draftAssemblyProposal } from '../../packages/composer-core/draft-proposal.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function offerDraftAssembly(view,next,error){
  const proposal=draftAssemblyProposal(next,view.catalog.clips);if(!proposal)return null;
  const dialog=document.createElement('dialog');dialog.className='fc-dialog fc-draft-assembly';
  dialog.innerHTML=`<form method="dialog"><h2>Use matching drafts?</h2><p>${esc(error.message)}</p><p><strong>${proposal.draftCount} additional draft video${proposal.draftCount===1?'':'s'}</strong> can fill this arrangement with your current categories and ${next.min_rating?next.min_rating+'★ minimum':'rating settings'}.</p><p>Accepting enables <strong>Include draft scripts</strong> for this session. Existing kept clips stay in place. ${next.repeat_policy==='cycle'?'Your repeat setting stays unchanged.':'No new video repeats will be added.'}</p>${proposal.fetchIds.length?`<p>${proposal.fetchIds.length} HF script set${proposal.fetchIds.length===1?'':'s'} will be downloaded. All selected videos are already linked locally.</p>`:''}<div class="fc-actions"><button value="cancel" autofocus>Cancel</button><button value="accept" class="fc-primary">${proposal.fetchIds.length?'Get scripts and use drafts':'Use drafts and assemble'}</button></div></form>`;
  const accepted=new Promise(resolve=>dialog.addEventListener('close',()=>{dialog.remove();resolve(dialog.returnValue==='accept');},{once:true}));
  view.root.append(dialog);dialog.showModal();
  return await accepted?proposal:null;
}
