import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {superviseChild} from '../qa-support/deadline-supervisor.mjs';
const fixture = fileURLToPath(new URL('./fixtures/deadline-child.mjs', import.meta.url));
const run = (mode, options = {}) => superviseChild({command: process.execPath, args: [fixture, mode], timeoutMs: 3000, ...options});
test('finishing within the budget is the only successful completion', async () => {
  const r = await run('fast'); assert(r.completed); assert(r.terminationVerified); assert.equal(r.stdout, 'done');
});
test('responsive supervisor stops its blocked child and rejects late success', {timeout: 10000}, async () => {
  const r = await run('blocked', {timeoutMs: 600, pollMs: 10});
  assert.equal(r.status, 'timed_out'); assert(!r.completed); assert(r.terminationVerified);
  assert(r.stdout.includes('blocking')); assert(!r.stdout.includes('late-success'));
  assert(r.wallElapsedMs >= 600 && r.wallElapsedMs < 2500);
});
test('cancellation before start does not spawn a child', async () => {
  const c = new AbortController(); c.abort(); const r = await run('blocked', {signal: c.signal});
  assert.equal(r.status, 'cancelled'); assert.equal(r.pid, null);
});
test('cancellation during execution reaps the direct child', async () => {
  const c = new AbortController(), p = run('blocked', {signal: c.signal});
  setTimeout(() => c.abort(), 150); const r = await p;
  assert.equal(r.status, 'cancelled'); assert(r.terminationVerified); assert(!r.completed);
});
test('output stays bounded and a truncated response is never successful', async () => {
  const r = await run('output', {maxOutputBytes: 128});
  assert.equal(r.status, 'output_limit'); assert.equal(r.capturedBytes, 128); assert(!r.completed);
});
test('failed commands and missing executables cannot masquerade as completed work', async () => {
  const failed = await run('failed'); assert.equal(failed.status, 'failed'); assert.equal(failed.exitCode, 7);
  const missing = await superviseChild({command: 'banxing-nonexistent-executable-for-test', timeoutMs: 1000});
  assert.equal(missing.status, 'failed'); assert(missing.spawnError);
});
