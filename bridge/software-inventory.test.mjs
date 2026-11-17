import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classify,combine,asInterfaces} from './software-inventory.mjs';
test('Windows cursor resource folder is not Cursor AI',()=>{assert.equal(classify('Cursors'),undefined);assert.equal(classify('Cursor.exe').id,'cursor');});
test('merges independent evidence without duplicate products',()=>{const rows=combine([{name:'WorkBuddy',source:'uninstall_registry'},{name:'WorkBuddy.exe',source:'process',pid:42,path:'F:/WorkBuddy.exe'}]);assert.equal(rows.length,1);assert.deepEqual(rows[0].sources,['uninstall_registry','process']);assert.equal(rows[0].pids[0],42);});
test('Codex packaged ChatGPT executable is attributed to Codex',()=>{assert.equal(combine([{name:'ChatGPT.exe',path:'C:\\Program Files\\WindowsApps\\OpenAI.Codex_123\\app\\ChatGPT.exe',source:'process'}])[0].id,'codex');});
test('configuration trace never implies authentication or chat',()=>{const [row]=asInterfaces({software:combine([{name:'Claude',source:'config_trace'}])});assert.equal(row.layers.authenticated,false);assert.equal(row.layers.chat_ok,false);assert.match(row.notes[0],/卸载/);});
test('unrelated applications do not become AI products',()=>{for(const name of ['explorer.exe','Thunder.exe','QQ.exe','Microsoft Edge','Paint','containerd'])assert.equal(classify(name),undefined);});
