import {test} from 'node:test';import assert from 'node:assert/strict';
import {requestWorkBuddyHandoff} from '../src/lib/workbuddyHandoffClient.ts';
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const options=(answers)=>{let count=0;return{fetchImpl:async()=>{const a=answers[count++];if(!a)throw Error('unexpected request');return a;},delay:async()=>{},attempts:2};};
test('client waits through queued state and only confirms matching handoff ID',async()=>{
 const o=options([response({dispatch:{id:'target'}},202),response({dispatches:[{id:'other',state:'awaiting_user'},{id:'target',state:'running'}]}),response({dispatches:[{id:'target',state:'awaiting_user'}]})]);
 assert.deepEqual(await requestWorkBuddyHandoff('http://localhost','test',o),{id:'target',confirmed:true});
});
test('client never treats an unconfirmed timeout as delivered',async()=>{const r=await requestWorkBuddyHandoff('http://localhost','test',options([response({dispatch:{id:'t'}},202),response({dispatches:[]}),response({dispatches:[{id:'t',state:'running'}]})]));assert.equal(r.confirmed,false);});
test('client displays backend launching failure',async()=>{await assert.rejects(requestWorkBuddyHandoff('x','test',options([response({dispatch:{id:'t'}},202),response({dispatches:[{id:'t',state:'failed',error:'fixture-launch-failed'}]})])),/fixture-launch-failed/);});
test('client preserves explicit HTTP errors and rejects missing IDs',async()=>{
 await assert.rejects(requestWorkBuddyHandoff('x','test',options([response({error:'fixture-409'},409)])),/fixture-409/);
 await assert.rejects(requestWorkBuddyHandoff('x','test',options([response({dispatch:{}},202)])),/有效交接记录/);
});
test('client rejects broken polling responses instead of claiming success',async()=>{
 await assert.rejects(requestWorkBuddyHandoff('x','test',options([response({dispatch:{id:'t'}},202),response({},502)])),/无法读取/);
 await assert.rejects(requestWorkBuddyHandoff('x','test',options([response({dispatch:{id:'t'}},202),response({})])),/格式无效/);
});
test('empty input never makes a network request',async()=>{await assert.rejects(requestWorkBuddyHandoff('x',' ',{fetchImpl:async()=>{throw Error('must not fetch');}}),/请输入/);});
