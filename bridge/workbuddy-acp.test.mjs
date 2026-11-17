import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { adapterWorkBuddyAcp } from './workbuddy-acp.mjs';

for (const channel of ['GET', 'POST', 'GET-idle16', 'EMPTY']) test(`ACP protocol regression: ${channel}`, async () => {
  let stream;
  let deleted = 0;
  const events=[];
  const server = http.createServer(async (req, res) => {
    if (req.url.endsWith('/connect')) { res.end(JSON.stringify({ connectionId: 'test' })); return; }
    if (req.method === 'DELETE') { deleted++; res.end('{}'); return; }
    if (req.method === 'GET') { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const msg = JSON.parse(raw);
    let result = {};
    if (msg.method === 'session/new') { assert.equal(msg.params.workingDirectory,process.cwd()); assert.equal(msg.params.cwd,process.cwd()); result = { sessionId: 'test-session', configOptions: [] }; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
    const target = channel.startsWith('GET') ? stream : res;
    if (channel === 'GET-idle16' && msg.method === 'session/prompt') { await new Promise(resolve=>setTimeout(resolve,16000)); target.write(`data: ${JSON.stringify({method:'session/update',params:{sessionId:'test-session',update:{sessionUpdate:'tool_call',title:'fixture tool'}}})}\n\n`); }
    if (channel !== 'EMPTY' && msg.method === 'session/prompt') target.write(`data: ${JSON.stringify({ method: 'session/update', params: { sessionId: 'test-session', update: { sessionUpdate: 'agent_message_chunk', content: { text: 'COOP-OK' } } } })}\n\n`);
    target.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const rec = { prompt: 'test', evidence: {} };
  try {
    const task=adapterWorkBuddyAcp(rec, process.cwd(), { port: server.address().port, token: 'test', update: (_rec, patch,event) => {Object.assign(rec, patch);if(event)events.push(event);}, redact: String });
    if(channel==='EMPTY') await assert.rejects(task,/没有模型回复/);
    else {await task;assert.equal(rec.reply, 'COOP-OK');}
    if(channel==='GET-idle16')assert.ok(events.some(event=>event.includes('fixture tool')));
    assert.equal(deleted, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
