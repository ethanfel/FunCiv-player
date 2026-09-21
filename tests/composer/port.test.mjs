import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { availablePort } from '../../electron/owned-backend-port.js';

test('a busy port stays owned by its server; FunCiv chooses another port',async()=>{
  const server=net.createServer(socket=>socket.end('still alive'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const port=server.address().port,selected=await availablePort(port);assert.notEqual(selected,port);
    const result=await new Promise((resolve,reject)=>{let data='';const socket=net.connect(port,'127.0.0.1');socket.on('error',reject);socket.on('data',chunk=>data+=chunk);socket.on('end',()=>resolve(data));});
    assert.equal(result,'still alive');
  }finally{await new Promise(resolve=>server.close(resolve));}
});
