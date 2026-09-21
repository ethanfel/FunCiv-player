import { allowsClipReview, clipRating, hasMotionForSection, isAudioSyncClip } from '../../packages/composer-core/index.mjs';

export function clipReadiness(clip,session={include_drafts:true,min_rating:0},section={motion:'clip'}){
  const video=clip.available?'local':clip.path?'missing':'unlinked';
  const motion=hasMotionForSection(clip,section)?'ready':clip.origin==='dataset'&&clip.remote_scripts?.L0?'fetch':'missing';
  const draft=!allowsClipReview(session,clip),rating=clipRating(clip)<(session.min_rating??0);
  return {video,motion,draft,rating,ready:video==='local'&&motion==='ready'&&!draft&&!rating};
}

export function folderReadiness(clips,session,section){
  const states=clips.map(c=>clipReadiness(c,session,section));
  const reasons=[
    [states.filter(s=>s.video==='unlinked').length,'video not linked','videos not linked'],
    [states.filter(s=>s.video==='missing').length,'local video unavailable','local videos unavailable'],
    [states.filter(s=>s.video==='local'&&s.motion==='fetch').length,'needs HF scripts','need HF scripts'],
    [states.filter(s=>s.video==='local'&&s.motion==='missing').length,'has no motion script','have no motion script'],
    [states.filter(s=>s.draft).length,'draft excluded','drafts excluded'],
    [states.filter(s=>s.rating).length,`below ${session.min_rating}★`,`below ${session.min_rating}★`],
  ].filter(([count])=>count).map(([count,one,many])=>`${count} ${count===1?one:many}`);
  return {total:clips.length,ready:states.filter(s=>s.ready).length,reasons};
}

export function pendingLocalScripts(clips,session){
  return clips.filter(c=>{
    const status=clipReadiness(c,session);
    return status.video==='local'&&status.motion==='fetch'&&!status.draft&&!status.rating&&!isAudioSyncClip(c);
  });
}

export function libraryVideoLabel(clip){
  const status=clipReadiness(clip);
  if(status.video==='unlinked')return 'Not linked';
  if(status.video==='missing')return 'File unavailable';
  return status.motion==='ready'?'Ready':status.motion==='fetch'?'Scripts needed':'Video only';
}
