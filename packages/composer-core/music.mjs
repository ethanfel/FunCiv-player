import { generateBeatSection, editBeatSections, BEAT_SHAPES, BEAT_CATALOG } from '../../vendor/motion-studio/audio-patterns.mjs';
import { evaluate } from '../../vendor/motion-studio/curve.mjs';

export const DEFAULT_MUSIC_SETTINGS=Object.freeze({mode:'waveform',shape:'Smooth Bounce',timing:'hits',bpm:120,
  rhythm:'simplify',density:1,lowFocus:.65,preserveSyncopation:true,maxHitsPerSecond:3,
  beatsPerCycle:1,amplitude:40,center:50,followEnergy:true,seed:1,association:'dual',beatLanding:'down',patternFamily:'all'});
export const createMusic=()=>({version:1,beat_track:null,analysis:null,offset_ms:0,settings:{...DEFAULT_MUSIC_SETTINGS},blocks:[]});

export function validateMusicSettings(settings){
  if(!settings||typeof settings!=='object')throw new Error('Music pattern settings are missing.');
  const s={...DEFAULT_MUSIC_SETTINGS,...settings};
  for(const [key,values] of Object.entries({mode:['manual','suggest','waveform','random'],shape:BEAT_SHAPES,
    timing:['hits','beats','tempo'],rhythm:['original','accents','simplify','steady'],density:[.5,1,2],beatsPerCycle:[.5,1,2,4,8],
    association:['beats','dual'],beatLanding:['down','up','shape'],patternFamily:['all',...new Set(BEAT_CATALOG.map(p=>p.family))]}))
    if(!values.includes(s[key]))throw new Error(`Choose a valid music ${key}.`);
  for(const [key,min,max] of [['bpm',30,300],['amplitude',0,50],['center',0,100],['lowFocus',0,1],['maxHitsPerSecond',.25,8],['seed',0,4294967295]])
    if(!Number.isFinite(s[key])||s[key]<min||s[key]>max||key==='seed'&&!Number.isInteger(s[key]))throw new Error(`Music ${key} must be between ${min} and ${max}.`);
  for(const key of ['followEnergy','preserveSyncopation'])if(typeof s[key]!=='boolean')throw new Error(`Music ${key} must be true or false.`);
  return s;
}
function validateAnalysis(analysis){
  if(!analysis||!Number.isFinite(analysis.duration_ms)||analysis.duration_ms<=0)throw new Error('Beat audio analysis has no duration.');
  if(!Array.isArray(analysis.waveform)||!analysis.waveform.length||analysis.waveform.length>100000||analysis.waveform.some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Beat audio waveform is invalid.');
  for(const name of ['beats','onsets','attacks','timbres']){
    const points=analysis[name];if(points===undefined&&!['beats','onsets'].includes(name))continue;
    if(!Array.isArray(points)||points.length>100000)throw new Error('Beat audio timing data is invalid.');
    let last=-1;
    for(const p of points){
      // Band attacks are grouped in refined peak order. Their coarse FFT frame
      // times can cross for nearby hits in different frequency bands.
      const orderedAt=name==='attacks'?(p.peak_at??p.at):p.at;
      if(!Number.isFinite(p.at)||p.at<0||orderedAt<last||p.at>analysis.duration_ms||p.peak_at!==undefined&&(!Number.isFinite(p.peak_at)||p.peak_at<0||p.peak_at>analysis.duration_ms))throw new Error('Beat audio timing data is invalid.');
      if(name!=='timbres'&&(!Number.isFinite(p.strength)||p.strength<0||p.strength>1))throw new Error('Beat audio strength is invalid.');
      if(p.bands!==undefined&&(!Array.isArray(p.bands)||p.bands.length!==3||p.bands.some(n=>!Number.isFinite(n)||n<0||n>1)))throw new Error('Beat audio frequency bands are invalid.');
      last=orderedAt;
    }
  }
}
export function validateMusic(music,duration){
  if(music===undefined)return;
  if(!music||music.version!==1||!Array.isArray(music.blocks)||music.blocks.length>5000)throw new Error('Invalid music editor data.');
  if(!Number.isInteger(music.offset_ms)||Math.abs(music.offset_ms)>86400000)throw new Error('Beat offset must be a whole millisecond within one day.');
  validateMusicSettings(music.settings);
  if(music.beat_track&&(!music.beat_track.id||!Number.isFinite(music.beat_track.duration_ms)||music.beat_track.duration_ms<=0))throw new Error('Beat audio track is invalid.');
  if(music.analysis){validateAnalysis(music.analysis);if(!music.beat_track||Math.abs(music.analysis.duration_ms-music.beat_track.duration_ms)>100)throw new Error('Beat analysis does not match the imported track.');}
  let end=0,pointCount=0;const ids=new Set();
  for(const b of music.blocks){
    if(!b.id||ids.has(b.id)||![b.start,b.end].every(Number.isInteger)||b.start<end||b.end<=b.start||b.end>duration)throw new Error('Music blocks must have unique IDs and non-overlapping song ranges.');
    ids.add(b.id);end=b.end;
    if(!Array.isArray(b.actions)||b.actions.length<2||(pointCount+=b.actions.length)>500000)throw new Error('Music blocks need a bounded script curve.');
    let at=b.start-1;
    for(const p of b.actions){if(!Number.isInteger(p.at)||p.at<=at||p.at<b.start||p.at>b.end||!Number.isFinite(p.pos)||p.pos<0||p.pos>100)throw new Error('Music points must increase in time and stay within 0–100.');at=p.at;}
    if(b.actions[0].at!==b.start||at!==b.end)throw new Error('Music curves must cover their block.');
    validateMusicSettings(b.settings);
    if(b.events!==undefined&&(!Array.isArray(b.events)||b.events.length>100000||b.events.some(p=>!Number.isInteger(p.at)||p.at<b.start||p.at>=b.end||!Number.isFinite(p.strength)||p.strength<0||p.strength>1)))throw new Error('Music timing events are invalid.');
  }
}
export function musicInput(session){
  const music=session.music,analysis=music?.beat_track?music.analysis:session.analysis;
  if(!analysis)throw new Error(music?.beat_track?'Analyze the drums / beat track in Music & beats first.':'Analyze the song before generating song motion, including Audio sync clips.');
  return {analysis,offset_ms:music?.offset_ms||0,...(music?.beat_track&&session.analysis?{mix:{analysis:session.analysis,offset_ms:0}}:{})};
}
export function generateMusicBlock(session,start,end,settings=session.music?.settings||DEFAULT_MUSIC_SETTINGS){
  if(![start,end].every(Number.isInteger)||start<0||end>session.song.duration_ms||end<=start)throw new Error('Choose a nonempty music range inside the song.');
  const options=validateMusicSettings(settings),input=musicInput(session);
  return {...generateBeatSection(input,start,end,options),audio_name:session.music?.beat_track?.name||session.song.name};
}
export function replaceMusicRange(session,start,end,replacement){
  const music=structuredClone(session.music||createMusic());
  music.blocks=editBeatSections(music.blocks,'',start,end,replacement).sections;
  music.settings={...replacement.settings};validateMusic(music,session.song.duration_ms);return music;
}
const slice=(actions,start,end)=>[{at:start,pos:evaluate(actions,start)},...actions.filter(p=>p.at>start&&p.at<end),{at:end,pos:evaluate(actions,end)}];

/** Saved blocks live on the song clock. Source-video trims never shift them. */
export function musicMotion(session,start,end,strength=100){
  const music=session.music,parts=[];let cursor=start;
  if(!music){
    const input=musicInput(session);
    return generateBeatSection(input,start,end,{mode:'manual',shape:'Sine Wave',timing:'tempo',bpm:session.bpm||input.analysis.bpm||120,
      amplitude:strength/2,center:50,followEnergy:true,seed:session.seed}).actions;
  }
  const fallback=(a,b)=>{
    if(b<=a)return;
    const input=musicInput(session),lo=Math.max(a,input.offset_ms),hi=Math.min(b,input.offset_ms+input.analysis.duration_ms);
    if(hi<=lo){parts.push([{at:a,pos:50},{at:b,pos:50}]);return;}
    const generated=generateMusicBlock(session,lo,hi).actions;
    parts.push([...(lo>a?[{at:a,pos:50},{at:lo-1,pos:50}]:[]),...generated,...(hi<b?[{at:hi+1,pos:50},{at:b,pos:50}]:[])]);
  };
  for(const block of music?.blocks||[]){
    if(block.end<=start||block.start>=end)continue;
    const a=Math.max(start,block.start),b=Math.min(end,block.end);fallback(cursor,a);parts.push(slice(block.actions,a,b));cursor=b;
  }
  fallback(cursor,end);
  const points=new Map();
  for(const actions of parts){
    const first=actions[0],previous=points.get(first.at);
    if(previous&&previous.pos!==first.pos&&first.at>start)points.set(first.at-1,{at:first.at-1,pos:previous.pos});
    for(const p of actions)points.set(p.at,p);
  }
  return [...points.values()].sort((a,b)=>a.at-b.at).map(p=>({at:p.at,pos:Math.round(50+(p.pos-50)*strength/100)}));
}
