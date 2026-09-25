import fs from 'node:fs/promises';
import path from 'node:path';
import {MangaService} from '../../electron/manga-service.cjs';
export const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value));};
export async function fixture(root,{media=true}={}){
  const project=path.join(root,'Test_book_project'),profile=path.join(root,'profile');const service=await new MangaService(path.join(profile,'manga')).init();
  await fs.mkdir(project,{recursive:true});
  const pages=[{page_id:'page_0001',width:320,height:360,image:'pages/page_0001/source.png',source_sha256:'first'},{page_id:'page_0002',width:320,height:360,image:'pages/page_0002/source.png',source_sha256:'second'}];
  await write(path.join(project,'project.json'),{schema_version:1,reading_direction:'ltr',pages});
  await write(path.join(project,'pages/page_0001/current.json'),{layout:'pages/page_0001/layouts/rev1/layout.json'});
  await write(path.join(project,'pages/page_0001/layouts/rev1/layout.json'),{panels:[]});
  await write(path.join(project,'pages/page_0002/current.json'),{layout:'pages/page_0002/layouts/rev2/layout.json'});
  const panels=[];
  for(let i=1;i<=2;i++){
    const id=`panel_${i}`,folder=`pages/page_0002/layouts/rev2/panels/${id}`,absolute=path.join(project,folder);panels.push({panel_id:id,folder});
    await write(path.join(absolute,'panel.json'),{panel_id:id,bbox:[0,(i-1)/2,1,i/2],polygon:null,reference:'reference.png'});
    for(const number of i===1?[1,3]:[1]){
      const take=`take_${String(number).padStart(4,'0')}`,rel=`takes/${take}`;await fs.mkdir(path.join(absolute,rel),{recursive:true});
      const record={schema_version:1,panel_id:id,video:`${rel}/video.mp4`,variants:{bubbles_off:`${rel}/video_clean.mp4`,bubbles_on:`${rel}/video.mp4`},bubble_layer:`${rel}/bubble_overlay.png`,clean_reference:`${rel}/first_frame.png`,actual_media:{duration_seconds:999,size:[320,180],has_audio:true}};
      if(media){await service.command('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${i===1?'teal':'purple'}:s=320x180:r=24:d=2`,'-f','lavfi','-i','sine=frequency=330:duration=2','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-threads','1',path.join(absolute,rel,'video_clean.mp4')]);
        await fs.copyFile(path.join(absolute,rel,'video_clean.mp4'),path.join(absolute,rel,'video.mp4'));
        await service.command('ffmpeg',['-v','error','-i',path.join(absolute,rel,'video_clean.mp4'),'-frames:v','1','-threads','1',path.join(absolute,rel,'first_frame.png')]);
        await service.command('ffmpeg',['-v','error','-f','lavfi','-i','color=white:s=100x40,format=rgba,pad=320:180:20:20:color=black@0','-frames:v','1','-threads','1',path.join(absolute,rel,'bubble_overlay.png')]);
        await fs.copyFile(path.join(absolute,rel,'first_frame.png'),path.join(absolute,'reference.png'));await fs.copyFile(path.join(absolute,'reference.png'),path.join(absolute,'clean_reference.png'));
      }else for(const f of ['video_clean.mp4','video.mp4','first_frame.png','bubble_overlay.png'])await fs.writeFile(path.join(absolute,rel,f),'fixture');
      await write(path.join(absolute,rel,'render.json'),record);
      if(i===1)await write(path.join(absolute,rel,'video_clean.funscript'),{actions:Array.from({length:9},(_,i)=>({at:i*250,pos:i%2?80:20}))});
    }
    if(i===1)await write(path.join(absolute,'main_take.json'),{take_id:'take_0001'});
  }
  await write(path.join(project,'pages/page_0002/layouts/rev2/layout.json'),{panels});
  if(media)for(const page of pages){await fs.mkdir(path.dirname(path.join(project,page.image)),{recursive:true});await service.command('ffmpeg',['-v','error','-f','lavfi','-i','color=white:s=320x360','-vf','drawbox=x=0:y=0:w=320:h=178:color=teal:t=fill,drawbox=x=0:y=182:w=320:h=178:color=purple:t=fill','-frames:v','1','-threads','1',path.join(project,page.image)]);}
  return {project,profile,service};
}

export async function timedBubbles(project,service){
  const dir=path.join(project,'pages/page_0002/layouts/rev2/panels/panel_1/takes/take_0001');
  await fs.mkdir(path.join(dir,'bubble_timeline'),{recursive:true});await fs.copyFile(path.join(dir,'bubble_overlay.png'),path.join(dir,'bubble_timeline/first.png'));
  await service.command('ffmpeg',['-v','error','-f','lavfi','-i','color=white:s=100x40,format=rgba,pad=320:180:200:20:color=black@0','-frames:v','1','-threads','1',path.join(dir,'bubble_timeline/repaired.png')]);
  const data={schema_version:1,fps:24,frames:48,size:[320,180],tracks:[
    {id:'first',image:'bubble_timeline/first.png',enabled:true,start_frame:6,end_frame:24,transition:{enter:'fade',enter_frames:6}},
    {id:'last',image:'bubble_timeline/repaired.png',enabled:true,start_frame:24,end_frame:48,transition:{enter:'pop',enter_frames:6}},
    {id:'hidden',image:'not-needed.png',enabled:false,start_frame:0,end_frame:48}
  ]};
  const file=path.join(dir,'bubble_timeline.json');await write(file,data);return {file,data};
}
