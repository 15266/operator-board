import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { adapterWorkBuddyAcp } from './workbuddy-acp.mjs';

for (const channel of ['GET', 'POST']) test(`ACP completes results delivered over ${channel}`, async () => {
  let stream;
  let deleted = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url.endsWith('/connect')) { res.end(JSON.stringify({ connectionId: 'test' })); return; }
    if (req.method === 'DELETE') { deleted++; res.end('{}'); return; }
    if (req.method === 'GET') { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const msg = JSON.parse(raw);
    let result = {};
    if (msg.method === 'session/new') result = { sessionId: 'test-session', configOptions: [] };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
    const target = channel === 'GET' ? stream : res;
    if (msg.method === 'session/prompt') target.write(`data: ${JSON.stringify({ method: 'session/update', params: { sessionId: 'test-session', update: { sessionUpdate: 'agent_message_chunk', content: { text: 'COOP-OK' } } } })}\n\n`);
    target.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const rec = { prompt: 'test', evidence: {} };
  try {
    await adapterWorkBuddyAcp(rec, process.cwd(), { port: server.address().port, token: 'test', update: (_rec, patch) => Object.assign(rec, patch), redact: String });
    assert.equal(rec.reply, 'COOP-OK');
    assert.equal(deleted, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
