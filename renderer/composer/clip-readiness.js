import { allowsClipReview, clipRating, hasMotionForSection, isAudioSyncClip, videoIdentities } from '../../packages/composer-core/index.mjs';
import { clipMetadataIndex, matchesSourceFilters } from '../../packages/composer-core/source-metadata.mjs';

export function clipReadiness(clip,session={include_drafts:true,min_rating:0},section={motion:'clip'},metadata){
  const video=clip.available?'local':clip.path?'missing':'unlinked';
  const motion=hasMotionForSection(clip,section)?'ready':clip.origin==='dataset'&&clip.remote_scripts?.L0?'fetch':'missing';
  const draft=!allowsClipReview(session,clip),rating=clipRating(clip)<(session.min_rating??0);
  const retired=clip.retired===true;
  const source=!matchesSourceFilters(clip,session,section,metadata);
  return {video,motion,draft,rating,retired,source,ready:video==='local'&&motion==='ready'&&!draft&&!rating&&!retired&&!source};
}

export function folderReadiness(clips,session,section,metadata){
  const identifiable=clips.map((c,i)=>({...c,id:c.id??`anonymous-${i}`})),identities=videoIdentities(identifiable),groups=new Map();
  metadata??=clipMetadataIndex(identifiable);
  for(const clip of identifiable){const id=identities.get(clip.id);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(clipReadiness(clip,session,section,metadata));}
  // Count a video once. Report the best usable variant, or the closest candidate
  // to being usable. A blocked HF variant must not mask a ready local sidecar.
  const cost=s=>Number(s.retired)*200+Number(s.source)*20+Number(s.draft)*20+Number(s.rating)*20+(s.video==='local'?0:100)+(s.motion==='ready'?0:s.motion==='fetch'?10:50);
  const states=[...groups.values()].map(variants=>variants.sort((a,b)=>cost(a)-cost(b))[0]);
  const reasons=[
    [states.filter(s=>s.video==='unlinked').length,'video not linked','videos not linked'],
    [states.filter(s=>s.video==='missing').length,'local video unavailable','local videos unavailable'],
    [states.filter(s=>s.video==='local'&&s.motion==='fetch').length,'needs HF scripts','need HF scripts'],
    [states.filter(s=>s.video==='local'&&s.motion==='missing').length,'has no motion script','have no motion script'],
    [states.filter(s=>s.draft).length,'draft excluded','drafts excluded'],
    [states.filter(s=>s.rating).length,`below ${session.min_rating}★`,`below ${session.min_rating}★`],
    [states.filter(s=>s.retired).length,'retired variant','retired variants'],
    [states.filter(s=>s.source).length,'outside source filters','outside source filters'],
  ].filter(([count])=>count).map(([count,one,many])=>`${count} ${count===1?one:many}`);
  return {total:groups.size,variants:clips.length,ready:states.filter(s=>s.ready).length,reasons};
}

export function pendingLocalScripts(clips,session){
  return clips.filter(c=>{
    const status=clipReadiness(c,session);
    return status.video==='local'&&status.motion==='fetch'&&!status.draft&&!status.rating&&!status.retired&&!isAudioSyncClip(c);
  });
}

export function libraryVideoLabel(clip){
  const status=clipReadiness(clip);
  if(status.video==='unlinked')return 'Not linked';
  if(status.video==='missing')return 'File unavailable';
  return status.motion==='ready'?'Ready':status.motion==='fetch'?'Scripts needed':'Video only';
}
