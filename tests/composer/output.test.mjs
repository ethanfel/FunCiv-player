import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, arrange, compile, validateSession, outputSettings, History } from '../../packages/composer-core/index.mjs';

test('output settings preserve old recipes, persist through history, and leave motion timing unchanged',()=>{
  const session=createSession({id:'song',name:'Song.wav',duration_ms:2000},1);
  const clips=[{id:'clip',name:'clip',duration_ms:2000,available:true,scripts:{L0:{actions:[{at:0,pos:0},{at:1000,pos:100},{at:2000,pos:0}]}}}];
  const arranged=arrange(session,clips),portrait=compile(arranged,clips);
  assert.deepEqual(portrait.output,{preset:'portrait-1080',width:1080,height:1920,fit:'cover',fps:30});
  const history=new History();history.record(arranged);delete arranged.output;
  const legacy=compile(arranged,clips);assert.deepEqual(legacy.output,{preset:'landscape-720',width:1280,height:720,fit:'contain',fps:30});
  assert.deepEqual(legacy.scripts,portrait.scripts);assert.deepEqual(legacy.placements,portrait.placements);
  const restored=history.undo(arranged);assert.deepEqual(compile(restored,clips).output,portrait.output);
  assert.deepEqual(compile(history.redo(restored),clips).output,legacy.output);
  const saved=JSON.parse(JSON.stringify(session));assert.deepEqual(outputSettings(saved),portrait.output);
});

test('only supported output presets and proportional framing modes are accepted',()=>{
  const session=createSession({id:'song',name:'Song.wav',duration_ms:1000});
  for(const output of [null,{},'portrait',{preset:'portrait-1080',fit:'stretch'},{preset:'arbitrary',fit:'cover'}])
    assert.throws(()=>validateSession({...session,output}),/output format and scaling mode/);
  for(const preset of ['portrait-1080','landscape-720'])for(const fit of ['contain','cover'])
    assert.doesNotThrow(()=>validateSession({...session,output:{preset,fit}}));
});
