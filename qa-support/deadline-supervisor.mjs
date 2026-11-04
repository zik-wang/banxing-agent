import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';

// Host-only prototype. It terminates its direct child, not a process tree.
// The supervisor must stay responsive; host suspend pauses both processes.
export function superviseChild({command, args = [], cwd, env, timeoutMs,
  signal, pollMs = 25, reapTimeoutMs = 1000, maxOutputBytes = 65536} = {}) {
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(a => typeof a !== 'string'))
    throw new TypeError('Host command and string arguments are required');
  for (const [name, value] of Object.entries({timeoutMs, pollMs, reapTimeoutMs, maxOutputBytes}))
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new TypeError(name + ' must be a positive bounded integer');
  const wallStart = Date.now(), monoStart = performance.now();
  return new Promise(resolve => {
    let child, stopped, closed = false, settled = false, reaper, poll, bytes = 0;
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), killError, spawnError;
    const elapsed = () => ({wallElapsedMs: Date.now() - wallStart, monoElapsedMs: performance.now() - monoStart});
    const expired = () => { const t = elapsed(); return Math.max(t.wallElapsedMs, t.monoElapsedMs) >= timeoutMs; };
    const finish = (exitCode = null, exitSignal = null, terminationVerified = closed) => {
      if (settled) return; settled = true;
      clearInterval(poll); clearTimeout(reaper); signal?.removeEventListener('abort', cancel);
      if (!stopped && expired()) stopped = 'timed_out'; // A late exit must never become trusted completion.
      const status = !terminationVerified && child?.pid ? 'termination_failed'
        : stopped || (spawnError || exitCode !== 0 ? 'failed' : 'completed');
      resolve({status, completed: status === 'completed', terminationVerified,
        pid: child?.pid ?? null, exitCode, exitSignal, ...elapsed(),
        stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), capturedBytes: bytes,
        ...(spawnError ? {spawnError} : {}), ...(killError ? {killError} : {})});
    };
    const stop = reason => {
      if (stopped || settled) return; stopped = reason;
      if (!child?.pid) { finish(); return; }
      try { if (!child.kill('SIGKILL')) killError = 'KILL_NOT_CONFIRMED'; }
      catch (e) { killError = e.code || 'KILL_FAILED'; }
      reaper = setTimeout(() => {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); finish(null, null, false);
      }, reapTimeoutMs);
    };
    const cancel = () => stop('cancelled');
    if (signal?.aborted) { stopped = 'cancelled'; finish(null, null, true); return; }
    signal?.addEventListener('abort', cancel, {once: true});
    try { child = spawn(command, args, {cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch (e) { spawnError = e.code || 'SPAWN_FAILED'; finish(null, null, true); return; }
    const capture = (stream, data) => {
      if (settled) return;
      const available = Math.max(0, maxOutputBytes - bytes), kept = data.subarray(0, available);
      bytes += kept.length;
      if (stream === 'stdout') stdout = Buffer.concat([stdout, kept]); else stderr = Buffer.concat([stderr, kept]);
      if (data.length > available) stop('output_limit');
    };
    child.stdout.on('data', b => capture('stdout', b)); child.stderr.on('data', b => capture('stderr', b));
    child.on('error', e => { spawnError = e.code || 'SPAWN_FAILED'; });
    child.once('close', (code, sig) => { closed = true; finish(code, sig, true); });
    poll = setInterval(() => { if (expired()) stop('timed_out'); }, pollMs);
    if (signal?.aborted) cancel(); else if (expired()) stop('timed_out');
  });
}
