// Real Electron smoke test. All media are synthesized in /tmp; no devices or
// account credentials are configured. Run: node tests/composer/smoke.mjs
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComposerService } from '../../electron/composer-service.cjs';

const checkout=fileURLToPath(new URL('../..',import.meta.url));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'funciv-electron-'));
const userData=path.join(root,'profile'),library=path.join(root,'clips','Pulse');await fs.mkdir(library,{recursive:true});
const service=await new ComposerService(path.join(userData,'composer')).init();
const signal=new AbortController().signal;let app;
try{
  for(const [name,color] of [['A','teal'],['B','purple']]){
    await service.run('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=320x180:r=30:d=2`,'-an','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',path.join(library,`${name}.mp4`)],signal);
    await fs.writeFile(path.join(library,`${name}.funscript`),JSON.stringify({actions:Array.from({length:9},(_,i)=>({at:i*250,pos:i%2?90:10}))}));
  }
  await service.run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=220:duration=6','-af',"volume='0.5+0.5*sin(4*PI*t)':eval=frame",path.join(root,'Preview song.wav')],signal);
  await service.scan(path.join(root,'clips'),signal);const song=await service.importSong(path.join(root,'Preview song.wav'),signal);
  app=await electron.launch({args:['--no-sandbox','--disable-gpu','--disable-frame-rate-limit','--disable-gpu-vsync',checkout],env:{...process.env,FUNCIV_USER_DATA:userData,CIVITAI_API_TOKEN:''},timeout:45000});
  const page=app.windows().find(p=>p.url().includes('index.html'))||await app.waitForEvent('window',{predicate:page=>page.url().includes('index.html'),timeout:30000}).catch(async()=>app.windows().find(p=>p.url().includes('index.html')));
  assert.ok(page,'main window opens');await page.setViewportSize({width:1500,height:1080});
  const until=async(fn,{timeout=30000}={})=>{const end=Date.now()+timeout;while(Date.now()<end){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+fn.toString());};
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await until(()=>!!window.app?.navBar?._el,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.app.buttplugManager.connected),false);
  await page.locator('.language-prompt__btn[data-locale=en]').click({force:true});
  console.log('Window and first-run language selection ready.');
  await page.locator('[data-view-id=composer]').click({force:true});
  await page.locator('#composer-container [data-field=song]').selectOption(song.id);
  await page.locator('[data-action=analyze]').click({force:true});
  await until(()=>!!window.app.composer.session.analysis,{timeout:20000});
  await page.locator('[data-action=assemble]').click({force:true});
  await until(()=>window.app.composer.session.placements.length>0);
  await page.locator('[data-action=prepare]').click({force:true});
  await until(()=>!!window.app.composer.prepared&&!window.app.composer.preparing,{timeout:20000});
  console.log('Song analyzed and preview prepared.');
  assert.equal(await page.evaluate(()=>window.app.composer.prepared.snapshot.scripts.L0.metadata.chapters[1].startTime),1000);
  await page.locator('[data-action=play]').click({force:true});
  await until(()=>window.app.composer.player.audio.currentTime>2.2,{timeout:15000});
  await page.locator('[data-action=play]').click({force:true});
  assert.equal(await page.evaluate(()=>window.app.composer.player.audio.paused),true);
  await page.evaluate(()=>window.app.composer.setPosition(4100));
  await until(()=>!window.app.composer.player.aligning);
  const clocks=await page.evaluate(()=>{const p=window.app.composer.player;return {audio:p.audio.currentTime,video:p.videos[p.active].currentTime,start:p.current.start_ms,paused:p.audio.paused};});
  assert.ok(Math.abs(clocks.video-(clocks.audio-clocks.start/1000))<.08);assert.ok(clocks.paused);
  await page.locator('[data-action=save]').click({force:true});await until(()=>window.app.composer.session.revision===1);
  await page.locator('[data-field=motion]').selectOption('song');
  await page.locator('[data-action=prepare]').click({force:true});await until(()=>!!window.app.composer.prepared&&!window.app.composer.preparing);
  assert.ok(await page.evaluate(()=>window.app.composer.prepared.snapshot.blocks.some(b=>b.kind==='song')));
  await page.locator('[data-action=render]').click({force:true});await until(()=>!!window.app.composer.rendered,{timeout:45000});
  await page.setViewportSize({width:1500,height:1280});
  await page.evaluate(()=>document.getElementById('composer-container').scrollTop=0);
  await page.screenshot({path:path.join(checkout,'docs','composer-implemented.png'),fullPage:true});
  await page.locator('[data-action=open-render]').click({force:true});
  await until(()=>window.app._currentView()==='player'&&window.app.funscriptEngine.isLoaded&&window.app.buttplugSync._axisActions.size===5);
  assert.equal(await page.evaluate(()=>window.app.videoPlayer.paused),true);
  assert.equal(await page.evaluate(()=>window.app.tcodeSync._axisActions.size),5);
  const backend=await page.evaluate(async()=>{const before=await window.funsync.getBackendPort(),result=await window.funsync.restartBackend();return {before,after:await window.funsync.getBackendPort(),result};});
  assert.ok(backend.result.success);assert.equal(backend.before,backend.after);
  assert.deepEqual(errors,[]);
  console.log('PASS: actual Electron launch, song analysis, assembly, clip switching, pause/seek, recipe save, song motion, FFmpeg export, and six-axis FunSync playback handoff.');
}catch(error){console.error(error.message);if(app){for(const page of app.windows())if(page.url().includes('index.html')){console.error(await page.evaluate(()=>({ready:document.readyState,nav:!!window.app?.navBar,navElement:!!window.app?.navBar?._el,status:document.querySelector('[data-status]')?.textContent,view:window.app?._currentView(),body:document.body.innerText.slice(0,1500)})));await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});}}throw error;}
finally{if(app){for(const page of app.windows())if(page.url().includes('index.html'))await page.evaluate(()=>{if(window.app?.composer)window.app.composer.dirty=false;}).catch(()=>{});app.process().kill('SIGTERM');await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
