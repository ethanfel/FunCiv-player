import test from 'node:test';
import assert from 'node:assert/strict';
import {MangaRunCache} from '../../electron/manga-run-cache.cjs';

test('preparing the next page retains current media and reuses the completed run',async()=>{
 const cache=new MangaRunCache(),calls=[];
 const build=key=>async(files,check)=>{check();calls.push(key);files.add(key+'.mp4');return {key};};
 await cache.get('page1',build('page1'));
 const ahead=await cache.get('page2',build('page2'),true);
 assert.deepEqual([...cache.protectedFiles].sort(),['page1.mp4','page2.mp4']);
 const selected=await cache.get('page2',build('page2'));
 assert.equal(selected,ahead);assert.deepEqual(calls,['page1','page2']);
 await cache.get('page3',build('page3'),true);
 assert.deepEqual([...cache.protectedFiles].sort(),['page2.mp4','page3.mp4']);assert.equal(cache.entries.size,2);
});
test('foreground and prefetch share in-flight work; superseded queued pages are skipped',async()=>{
 const cache=new MangaRunCache();let release,calls=0;
 const first=cache.get('first',async files=>{calls++;files.add('first');await new Promise(r=>release=r);return {key:'first'};});
 await new Promise(r=>setImmediate(r));
 const stale=cache.get('stale',async()=>{throw new Error('stale work must not run');},true);
 const rejected=assert.rejects(stale,/superseded/);
 const upcoming=cache.get('next',async files=>{calls++;files.add('next');return {key:'next'};},true);
 const foreground=cache.get('next',async()=>{throw new Error('duplicate work');});
 release();await first;await rejected;assert.equal(await upcoming,await foreground);assert.equal(calls,2);
 cache.clearAhead();assert.equal(cache.entries.size,1);assert.deepEqual([...cache.protectedFiles],['next']);
});
