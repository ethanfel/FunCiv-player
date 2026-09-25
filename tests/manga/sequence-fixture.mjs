import fs from 'node:fs/promises';
import path from 'node:path';
import {write} from './fixtures.mjs';

export async function joinedTakes(project){
  const folder='pages/page_0002/layouts/rev2/panels/panel_1',base=path.join(project,folder);
  const variant='flf_1111111111111111',other='flf_2222222222222222';
  for(const [number,pair] of [[3,variant],[4,variant],[5,other]]){
    const id=`take_${String(number).padStart(4,'0')}`,dir=path.join(base,'takes',id);
    if(number!==3)await fs.cp(path.join(base,'takes/take_0003'),dir,{recursive:true});
    const file=path.join(dir,'render.json'),render=JSON.parse(await fs.readFile(file,'utf8'));
    for(const key of ['video','bubble_layer','clean_reference'])render[key]=render[key].replace('take_0003',id);
    for(const key of Object.keys(render.variants))render.variants[key]=render.variants[key].replace('take_0003',id);
    render.settings={reference_position:pair};render.flf_pair={variant:pair,endpoints:['panel_1','panel_2']};await write(file,render);
    if(number===4)await write(path.join(dir,'video_clean.funscript'),{actions:[{at:0,pos:60},{at:1000,pos:80},{at:2000,pos:60}]});
  }
  await write(path.join(base,'main_take.json'),{take_id:'take_0003'});
  const pair={variant,label:'Panel 1 → Panel 2',endpoints:[{panel_id:'panel_1',folder},{panel_id:'panel_2',folder:'pages/page_0002/layouts/rev2/panels/panel_2'}]};
  const file=path.join(project,'flf_sequence.json');await write(file,{schema_version:1,pairs:[pair]});
  return {file,pair,base};
}
