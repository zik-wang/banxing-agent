import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {ToolHarness, runToolAgent, chatApi} from '../v8-tools/harness.mjs';

const messages = [{role: 'user', content: 'Return the completed result.'}];
const freshSignal = () => new AbortController().signal;
const message = (content = 'completed') => ({role: 'assistant', content});
const response = (reply = message(), finishReason = 'stop') => new Response(JSON.stringify({choices: [{finish_reason: finishReason, message: reply}]}), {status: 200});
const reset = (code = 'ECONNRESET', detail = 'peer reset connection') => new TypeError('fetch failed', {cause: Object.assign(new Error(detail), {code})});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-model-transport-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  return root;
}

function apiWith(fetchImpl, options = {}) {
  return chatApi({baseUrl: 'http://127.0.0.1:1/v1', model: 'transport-fixture', provider: 'intranet', fetchImpl, timeoutMs: 1000, retryDelaysMs: [0, 0], ...options});
}

function receipts(directory) {
  return fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', abort, {once: true});
  });
}

test('a reset is retried and reports actual transport attempts before each fetch', async () => {
  let calls = 0;
  const order = [];
  const api = apiWith(async () => {
    order.push('fetch');
    if (++calls === 1) throw reset();
    return response();
  }, {onAttempt: () => { order.push('attempt'); }});
  assert.deepEqual(await api(messages, [], freshSignal()), message());
  assert.deepEqual(order, ['attempt', 'fetch', 'attempt', 'fetch']);
  assert.equal(api.metrics().logicalRequests, 1);
  assert.equal(api.metrics().networkAttempts, 2);
  assert.equal(api.metrics().retries, 1);
  assert.equal(api.metrics().recoveredRequests, 1);
});

test('a native fetch failure without a nested code still receives bounded transport recovery', async () => {
  let calls = 0;
  const api = apiWith(async () => { if (++calls === 1) throw new TypeError('fetch failed'); return response(); });
  assert.equal((await api(messages, [], freshSignal())).content, 'completed');
  assert.equal(calls, 2);
  assert.equal(api.metrics().retries, 1);
});

test('a response body socket disconnect is retried rather than escaping unrecorded', async t => {
  const directory = fixture(t);
  let calls = 0;
  const api = apiWith(async () => {
    if (++calls === 1) return {ok: true, status: 200, text: async () => { throw new TypeError('terminated', {cause: Object.assign(new Error('other side closed'), {code: 'UND_ERR_SOCKET'})}); }};
    return response();
  }, {logDirectory: directory});
  assert.equal((await api(messages, [], freshSignal())).content, 'completed');
  assert.equal(calls, 2);
  const logs = receipts(directory);
  assert.equal(logs.length, 2);
  const failed = logs.find(log => log.error);
  assert.equal(failed.phase, 'response_body');
  assert.equal(failed.networkRequestAttempted, true);
  assert.match(JSON.stringify(failed), /UND_ERR_SOCKET/);
  assert.equal(api.metrics().recoveredRequests, 1);
});

test('persistent resets exhaust the bounded retry count and retain all failed attempts', async t => {
  const directory = fixture(t);
  let calls = 0;
  const api = apiWith(async () => { calls++; throw reset('EPIPE'); }, {logDirectory: directory});
  await assert.rejects(api(messages, [], freshSignal()), error => error.code === 'MODEL_NETWORK_ERROR');
  assert.equal(calls, 3);
  assert.equal(api.metrics().logicalRequests, 1);
  assert.equal(api.metrics().networkAttempts, 3);
  assert.equal(api.metrics().retries, 2);
  assert.equal(api.metrics().recoveredRequests, 0);
  const logs = receipts(directory).sort((a, b) => a.attempt - b.attempt);
  assert.equal(logs.length, 3);
  assert.deepEqual(logs.map(log => log.attempt), [1, 2, 3]);
  assert.equal(new Set(logs.map(log => log.requestId)).size, 1);
  assert(logs.every(log => log.requestId && log.error && log.networkRequestAttempted === true));
});

test('a per-request maximum bounds attempts without altering the next request default', async () => {
  let calls = 0;
  const api = apiWith(async () => { calls++; throw reset(); });
  await assert.rejects(api(messages, [], freshSignal(), {maxAttempts: 1}));
  assert.equal(calls, 1);
  await assert.rejects(api(messages, [], freshSignal()));
  assert.equal(calls, 4);
  assert.equal(api.metrics().logicalRequests, 2);
  assert.equal(api.metrics().retries, 2);
});

test('already cancelled requests make no network attempt', async () => {
  let calls = 0, announced = 0;
  const controller = new AbortController();
  controller.abort(new Error('user cancelled'));
  const api = apiWith(async () => { calls++; return response(); }, {onAttempt: () => { announced++; }});
  await assert.rejects(api(messages, [], controller.signal), error => error.code === 'MODEL_REQUEST_CANCELLED');
  assert.equal(calls, 0);
  assert.equal(announced, 0);
  assert.equal(api.metrics().networkAttempts, 0);
});

test('host budget rejection before an attempt preserves its error and counts a failed logical request', async () => {
  let calls = 0, announced = 0;
  const budgetError = Object.assign(new Error('host model budget exhausted'), {code: 'CUMULATIVE_MODEL_BUDGET_EXHAUSTED'});
  const api = apiWith(async () => { calls++; return response(); }, {onAttempt: () => { announced++; throw budgetError; }});
  await assert.rejects(api(messages, [], freshSignal()), error => error === budgetError);
  assert.equal(announced, 1);
  assert.equal(calls, 0);
  assert.equal(api.metrics().logicalRequests, 1);
  assert.equal(api.metrics().networkAttempts, 0);
  assert.equal(api.metrics().retries, 0);
  assert.equal(api.metrics().failedRequests, 1);
});

test('cancelling an in-flight request never retries or returns a late answer', async () => {
  let calls = 0;
  const controller = new AbortController();
  const api = apiWith(async (_url, init) => {
    calls++;
    controller.abort(new Error('user cancelled during fetch'));
    await abortableDelay(1000, init.signal);
    return response();
  });
  await assert.rejects(api(messages, [], controller.signal), error => error.code === 'MODEL_REQUEST_CANCELLED');
  assert.equal(calls, 1);
  assert.equal(api.metrics().retries, 0);
});

test('timeout is one logical request deadline across retry delay and fetches', {timeout: 3000}, async () => {
  let calls = 0;
  const started = Date.now();
  const api = apiWith(async (_url, init) => {
    calls++;
    if (calls === 1) {
      await abortableDelay(45, init.signal);
      throw reset();
    }
    await abortableDelay(1000, init.signal);
    return response();
  }, {timeoutMs: 100, retryDelaysMs: [35, 0]});
  await assert.rejects(api(messages, [], freshSignal()), error => error.code === 'MODEL_REQUEST_TIMEOUT');
  const elapsed = Date.now() - started;
  assert.equal(calls, 2);
  assert(elapsed < 165, `deadline was reset for the retry (${elapsed}ms)`);
  assert.equal(api.metrics().retries, 1);
});

test('cancellation during retry backoff prevents the next fetch', async () => {
  let calls = 0;
  const controller = new AbortController();
  const api = apiWith(async () => { calls++; setTimeout(() => controller.abort(new Error('cancel during backoff')), 5); throw reset(); }, {retryDelaysMs: [100, 100]});
  await assert.rejects(api(messages, [], controller.signal), error => error.code === 'MODEL_REQUEST_CANCELLED');
  assert.equal(calls, 1);
  assert.equal(api.metrics().networkAttempts, 1);
});

test('HTTP errors, malformed output, model truncation and unknown errors are not transport retries', async t => {
  const cases = [
    ['401', () => new Response('{"error":"unauthorized"}', {status: 401}), 'MODEL_HTTP_ERROR'],
    ['400', () => new Response('{"error":"bad request"}', {status: 400}), 'MODEL_HTTP_ERROR'],
    ['invalid JSON', () => new Response('this is not JSON', {status: 200}), 'MODEL_INVALID_JSON'],
    ['truncated output', () => response(message('cut off'), 'length'), 'MODEL_OUTPUT_TRUNCATED'],
    ['unclassified TypeError', () => { throw new TypeError('invalid request configuration'); }, null],
    ['permission error', () => { throw Object.assign(new Error('access denied'), {code: 'EACCES'}); }, null],
  ];
  for (const [name, makeResponse, code] of cases) await t.test(name, async () => {
    let calls = 0;
    const api = apiWith(async () => { calls++; return makeResponse(); });
    await assert.rejects(api(messages, [], freshSignal()), error => !code || error.code === code);
    assert.equal(calls, 1);
    assert.equal(api.metrics().networkAttempts, 1);
    assert.equal(api.metrics().retries, 0);
  });
});

test('an HTTP failure remains nonretryable when its error response body disconnects', async t => {
  for (const status of [401, 503]) await t.test(String(status), async () => {
    let calls = 0;
    const api = apiWith(async () => {
      calls++;
      return {ok: false, status, text: async () => { throw reset('UND_ERR_SOCKET'); }};
    });
    await assert.rejects(api(messages, [], freshSignal()), error => error.code === 'MODEL_HTTP_ERROR');
    assert.equal(calls, 1);
    assert.equal(api.metrics().networkAttempts, 1);
    assert.equal(api.metrics().retries, 0);
  });
});

test('attempt receipts correlate recovery and redact the API key throughout nested causes', async t => {
  const directory = fixture(t);
  const key = 'sk-fixture-never-store-this-secret';
  let calls = 0;
  const api = apiWith(async () => {
    if (++calls === 1) {
      const cause = Object.assign(new Error(`socket closed with credential ${key}`), {code: 'ECONNRESET', cause: new Error(`nested ${key}`)});
      throw new TypeError(`fetch failed ${key}`, {cause});
    }
    return response(message(`provider echoed ${key}`));
  }, {apiKey: key, logDirectory: directory});
  const reply = await api(messages, [], freshSignal());
  assert(!JSON.stringify(reply).includes(key));
  const raw = fs.readdirSync(directory).map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
  assert(!raw.includes(key));
  assert.match(raw, /REDACTED/);
  const logs = receipts(directory).sort((a, b) => a.attempt - b.attempt);
  assert.equal(logs.length, 2);
  assert.equal(logs[0].requestId, logs[1].requestId);
  assert(logs[0].requestId);
  assert.deepEqual(logs.map(log => log.attempt), [1, 2]);
  assert(logs.every(log => Number.isInteger(log.attemptCount) && log.attemptCount >= log.attempt));
  assert(logs.every(log => log.networkRequestAttempted === true));
  assert.equal(logs[0].phase, 'fetch');
  assert.equal(logs[1].httpStatus, 200);
  assert.match(JSON.stringify(logs[0].error), /ECONNRESET/);
  assert.match(JSON.stringify(logs[0].error), /nested/);
});

test('real Node fetch recovers from a destroyed HTTP socket and disables connection reuse', {timeout: 5000}, async t => {
  let calls = 0;
  const connectionHeaders = [];
  const server = http.createServer((req, res) => {
    calls++;
    connectionHeaders.push(req.headers.connection);
    req.resume();
    req.on('end', () => {
      if (calls === 1) return req.socket.destroy();
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({choices: [{finish_reason: 'stop', message: message()}]}));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const api = chatApi({baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'local-fixture', provider: 'intranet', disableKeepAlive: true, timeoutMs: 2000, retryDelaysMs: [0, 0]});
  assert.equal((await api(messages, [], freshSignal())).content, 'completed');
  assert.equal(calls, 2);
  assert.deepEqual(connectionHeaders, ['close', 'close']);
  assert.equal(api.metrics().networkAttempts, 2);
  assert.equal(api.metrics().recoveredRequests, 1);
});

function countingHarness(t, effect) {
  return new ToolHarness({directory: fixture(t), tools: [{name: 'record_delivery', description: 'Record one delivery', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, execute: effect}]});
}

const toolReply = () => ({role: 'assistant', content: null, tool_calls: [{id: 'delivery-once', type: 'function', function: {name: 'record_delivery', arguments: '{}'}}]});

test('agent retry recovery never replays an already executed tool', async t => {
  let effects = 0, calls = 0;
  const harness = countingHarness(t, async () => ({saved: ++effects}));
  const api = apiWith(async (_url, init) => {
    calls++;
    if (calls === 1 || calls === 3) throw reset();
    const sent = JSON.parse(init.body);
    if (calls === 2) return response(toolReply(), 'tool_calls');
    assert.equal(sent.messages.filter(item => item.role === 'tool').length, 1);
    return response();
  });
  const result = await runToolAgent({harness, next: api, request: 'Record exactly one delivery and confirm.', maxRounds: 4});
  assert.equal(calls, 4);
  assert.equal(effects, 1);
  assert.equal(result.calls, 1);
  assert.equal(result.answer, 'completed');
  assert.equal(api.metrics().networkAttempts, 4);
  assert.equal(api.metrics().logicalRequests, 2);
});

test('agent physical budget includes retries and passes the remaining attempt allowance', async t => {
  let effects = 0, calls = 0;
  const harness = countingHarness(t, async () => ({saved: ++effects}));
  const api = apiWith(async () => { calls++; if (calls === 2) return response(toolReply(), 'tool_calls'); throw reset(); });
  const allowances = [];
  const next = (...args) => { allowances.push(args[3]?.maxAttempts); return api(...args); };
  next.metrics = () => api.metrics();
  const result = await runToolAgent({harness, next, request: 'Record one delivery and confirm.', maxRounds: 3});
  assert.equal(calls, 3, 'a logical second turn must not obtain three more transport attempts');
  assert.deepEqual(allowances, [3, 1]);
  assert.equal(effects, 1);
  assert.equal(result.calls, 1);
  assert(result.termination);
  assert.notEqual(result.answer, 'completed');
  assert.equal(api.metrics().networkAttempts, 3);
});
