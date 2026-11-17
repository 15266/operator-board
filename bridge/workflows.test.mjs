import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {validateDispatch,isPendingDispatch,closeHandoff,readObjectBody} from './dispatch-validation.mjs';
import {executorDispatchGate,DISPATCH_LABEL} from '../src/lib/bridge.ts';
import {isDetectedExecutorRow,isGuiKingExecutor} from '../src/lib/localExecutors.ts';
test('WorkBuddy desktop handoff needs desktop executable, not gateway token',()=>{
 assert.equal(executorDispatchGate('workbuddy',{workbuddy:{desktop_detected:true,public_gateway:false,exe_path:'F:/wb/WorkBuddy.exe',token:false}},true).ok,true);
 assert.equal(executorDispatchGate('workbuddy',{workbuddy:{health:200,token:true,desktop_detected:false}},true).ok,false);
 assert.equal(executorDispatchGate('workbuddy',{workbuddy:{desktop_detected:true}},true).ok,false);
});
test('offline bridge and missing executors cannot dispatch',()=>{assert.equal(executorDispatchGate('workbuddy',null,false).ok,false);assert.equal(executorDispatchGate('unknown',{},true).ok,false);assert.equal(executorDispatchGate('codex',{},true).ok,false);});
test('Codex dispatch protection checks CLI, proxy and local request cap separately',()=>{
 assert.equal(executorDispatchGate('codex',{codex:{cli:true,proxy_up:false}},true).ok,false);
 assert.equal(executorDispatchGate('codex',{codex:{cli:true,proxy_up:true,used:1,max:1}},true).ok,false);
 assert.equal(executorDispatchGate('codex',{codex:{cli:true,proxy_up:true,used:0,max:1}},true).ok,true);
});
test('Doubao requires CDP and a work-task script (local or dsh-doubao-bridge)',()=>{
 assert.equal(executorDispatchGate('doubao',{doubao:{cdp:true,bridge_cli:false}},true).ok,false);
 assert.equal(executorDispatchGate('doubao',{doubao:{cdp:true,local_work_task:true,bridge_cli:false}},true).ok,true);
 assert.equal(executorDispatchGate('doubao',{doubao:{cdp:true,bridge_cli:true}},true).ok,true);
 assert.equal(executorDispatchGate('doubao',{doubao:{cdp:false,local_work_task:true}},true).ok,false);
});
test('discovery-only unsupported products and examples cannot become executors',()=>{
 const row={scanner_id:'workbuddy',source:'live',uiStatus:'discovered'};
 assert.equal(isDetectedExecutorRow(row),true);assert.equal(isDetectedExecutorRow({...row,scanner_id:'chatgpt'}),false);assert.equal(isDetectedExecutorRow({...row,source:'example'}),false);assert.equal(isDetectedExecutorRow({...row,uiStatus:'not_found'}),false);
 assert.equal(isGuiKingExecutor('codex','cli'),false);assert.equal(isGuiKingExecutor('workbuddy'),true);
});
test('waiting is pending, never a completed reply; closing does not claim task completion',()=>{
 assert.equal(isPendingDispatch('awaiting_user'),true);assert.equal(isPendingDispatch('handoff_closed'),false);
 const r={state:'awaiting_user',evidence:{auto_sent:false},reply:null};const closed=closeHandoff(r,'fixture-time');
 assert.equal(closed.state,'handoff_closed');assert.equal(closed.reply,null);assert.equal(closed.evidence.auto_sent,false);assert.equal(r.state,'awaiting_user');assert.ok(DISPATCH_LABEL.handoff_closed);assert.throws(()=>closeHandoff({state:'running'}),e=>e.status===409);
});
test('invalid dispatches fail before record creation or process launching',()=>{
 for(const b of [null,[],1,{}, {executor:'unknown',prompt:'x'},{executor:'codex',prompt:{}},{executor:'codex',prompt:'  '},{executor:'codex',prompt:'x',task_id:{}},{executor:'codex',prompt:'x',force:true}])assert.throws(()=>validateDispatch(b),e=>e.status===400);
 assert.throws(()=>validateDispatch({executor:'workbuddy',prompt:'x'.repeat(128001)}),e=>e.status===413);
 assert.equal(validateDispatch({executor:'workbuddy',prompt:' test '}).prompt,'test');
});
test('bad JSON, arrays and oversized HTTP bodies have explicit 4xx errors',async()=>{
 const req=text=>Readable.from([Buffer.from(text)]);
 for(const t of ['{','null','[]','1'])await assert.rejects(readObjectBody(req(t)),e=>e.status===400);
 await assert.rejects(readObjectBody(req('{"x":"too large"}'),5),e=>e.status===413);
 assert.deepEqual(await readObjectBody(req('{"x":1}')),{x:1});
});
