import test from 'node:test';import assert from 'node:assert/strict';
import {createSiliconflowRelay} from '../qa-support/siliconflow-relay.mjs';
const auth = {Authorization: 'Bearer synthetic-test-only', 'Content-Type': 'application/json'};
const payload = JSON.stringify({model: 'Qwen/Qwen3.8-27B', stream: true, messages: []});
async function fixture(t, {fetchImpl, withSlot, onRecord}) {
  const server = createSiliconflowRelay({fetchImpl, withSlot, onRecord});
  for (let n = 0; ; n++) {
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(45000 + Math.floor(Math.random() * 15000), '127.0.0.1', resolve); }); break; }
    catch (e) { if (e.code !== 'EADDRINUSE' || n >= 10) throw e; }
  }
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return 'http://127.0.0.1:' + server.address().port;
}
for (const contentType of ['application/json', 'text/event-stream']) test('slot covers complete ' + contentType + ' consumption', async t => {
  let bodyClosed = false, held = false, releases = 0; const events = [];
  const text = contentType === 'application/json' ? '{"ok":true}' : 'data: {"delta":"ok"}\n\ndata: [DONE]\n\n';
  const base = await fixture(t, {onRecord: e => events.push(e),
    withSlot: async fn => { assert(!held); held = true; const r = await fn(); assert(bodyClosed); held = false; releases++; return r; },
    fetchImpl: async (url, options) => { assert(held); assert.equal(url, 'https://api.siliconflow.cn/v1/chat/completions');
      assert.equal(Buffer.from(options.body).toString(), payload); assert.equal(options.headers.authorization, auth.Authorization);
      return new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode(text.slice(0, 5)));
        setTimeout(() => { assert(held); c.enqueue(new TextEncoder().encode(text.slice(5))); bodyClosed = true; c.close(); }, 25); }}), {headers: {'Content-Type': contentType}});
    }});
  const response = await fetch(base + '/v1/chat/completions', {method: 'POST', headers: auth, body: payload});
  assert.equal(await response.text(), text); await new Promise(r => setTimeout(r, 5));
  assert.equal(releases, 1); assert(events.some(e => e.event === 'provider-end' && e.bodyFullyConsumed && e.queueWaitMs >= 0));
});
test('429 body completes before shared cooldown outcome is returned, without local retry', async t => {
  let calls = 0, outcome;
  const base = await fixture(t, {withSlot: async fn => outcome = await fn(), fetchImpl: async () => {
    calls++; return new Response('{"code":"rate-limit"}', {status: 429, headers: {'Retry-After': '17'}});
  }});
  const r = await fetch(base + '/v1/chat/completions', {method: 'POST', headers: auth, body: payload}); await r.text();
  assert.equal(calls, 1); assert.equal(outcome.status, 429); assert.equal(outcome.retry_after_seconds, '17');
});
test('uncertain network failure retains the shared lease decision', async t => {
  let outcome;
  const base = await fixture(t, {withSlot: async fn => outcome = await fn(), fetchImpl: async () => { throw Error('synthetic disconnect'); }});
  const r = await fetch(base + '/v1/chat/completions', {method: 'POST', headers: auth, body: payload}); await r.text();
  assert.equal(r.status, 502); assert.equal(outcome.uncertain, true);
});
test('health, unsupported routes and unauthorized models never acquire an SF slot', async t => {
  let slots = 0;
  const base = await fixture(t, {withSlot: async () => { slots++; throw Error('Unexpected slot'); }});
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/other')).status, 404);
  assert.equal((await fetch(base + '/v1/chat/completions', {method: 'POST', headers: auth, body: '{"model":"other"}'})).status, 403);
  assert.equal(slots, 0);
});
test('a disconnected client cannot release a still-streaming provider request', async t => {
  let held = false, finishSource, released;
  const ended = new Promise(r => released = r);
  const base = await fixture(t, {withSlot: async fn => { held = true; const r = await fn(); held = false; released(); return r; },
    fetchImpl: async () => new Response(new ReadableStream({start(c) {
      c.enqueue(new TextEncoder().encode('data: first\n\n'));
      finishSource = () => { c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); };
    }}), {headers: {'Content-Type': 'text/event-stream'}})});
  const cancel = new AbortController();
  const response = await fetch(base + '/v1/chat/completions', {method: 'POST', headers: auth, body: payload, signal: cancel.signal});
  await response.body.getReader().read(); cancel.abort(); await new Promise(r => setTimeout(r, 20));
  assert(held); finishSource(); await ended; assert(!held);
});
test('a paused or unavailable shared queue never dispatches to the provider', async t => {
  let calls = 0;
  const base = await fixture(t, {withSlot: async () => { throw Error('synthetic paused queue'); }, fetchImpl: async () => { calls++; }});
  const r = await fetch(base + '/v1/chat/completions', {method: 'POST', headers: auth, body: payload});
  assert.equal(r.status, 503); await r.text(); assert.equal(calls, 0);
});
