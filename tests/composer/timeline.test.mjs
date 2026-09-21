import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomGeometry, rulerInterval } from '../../renderer/composer/timeline-viewport.js';

test('zoom keeps the time under the pointer fixed and clamps panning to the song',()=>{
  const width=900,oldZoom=4,scroll=710,anchor=570,next=zoomGeometry(width,oldZoom,16,scroll,anchor);
  assert.equal((scroll+anchor)/(width*oldZoom),(next.scrollLeft+anchor)/next.contentWidth);
  assert.deepEqual(zoomGeometry(width,16,1,next.scrollLeft,anchor),{zoom:1,contentWidth:900,scrollLeft:0});
  assert.equal(zoomGeometry(width,1,999,0,0).zoom,256);
  assert.equal(zoomGeometry(width,4,2,90000,anchor).scrollLeft,900);
  for(const scale of [.1,1,10,100,1000])assert.ok(rulerInterval(scale)/scale>=95,'ruler labels remain readable at different zoom levels');
});
