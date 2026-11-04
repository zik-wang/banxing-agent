import http from 'node:http';
import {performance} from 'node:perf_hooks';
import {randomUUID, createHash} from 'node:crypto';

// withSlot is supplied by the local shared scheduler. Each callback owns one
// HTTP request through upstream EOF, never the lifetime of this server.
export function createSiliconflowRelay({withSlot, fetchImpl = fetch, onRecord = () => {},
  providerTimeoutMs = 300000, maxRequestBytes = 8 * 1024 * 1024} = {}) {
  if (typeof withSlot !== 'function') throw new TypeError('Shared slot callback required');
  const writeJson = (res, status, data) => { if (res.destroyed) return; if (res.headersSent) { res.destroy(); return; }
    res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); };
  return http.createServer(async (req, res) => {
    const requestId = randomUUID(), receivedAt = performance.now();
    const record = (event, data = {}) => onRecord({event, requestId, at: new Date().toISOString(), ...data});
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/health' && req.method === 'GET') {
        writeJson(res, 200, {role: 'worker05-sf-relay', upstream: 'api.siliconflow.cn', boundary: 'upstream-body-eof'}); return;
      }
      if (!((req.method === 'POST' && url.pathname === '/v1/chat/completions') ||
        (req.method === 'GET' && url.pathname === '/v1/models'))) { writeJson(res, 404, {error: 'Unsupported route'}); return; }
      if (!/^Bearer\s+\S+$/i.test(req.headers.authorization || '')) { writeJson(res, 401, {error: 'Original provider authentication required'}); return; }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > maxRequestBytes) { writeJson(res, 413, {error: 'Request too large'}); return; } chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      if (req.method === 'POST') {
        let parsed; try { parsed = JSON.parse(body); } catch { writeJson(res, 400, {error: 'JSON required'}); return; }
        if (parsed.model !== 'Qwen/Qwen3.8-27B') { writeJson(res, 403, {error: 'Model outside this authorized trial'}); return; }
      }
      const enqueuedAt = performance.now();
      record('enqueued', {prepareMs: enqueuedAt - receivedAt, requestBytes: body.length, requestSha256: createHash('sha256').update(body).digest('hex')});
      await withSlot(async () => {
        const acquiredAt = performance.now(), queueWaitMs = acquiredAt - enqueuedAt;
        if (res.destroyed) { record('cancelled-before-dispatch', {queueWaitMs}); return {status: 499}; }
        record('provider-start', {queueWaitMs, providerTimeoutMs});
        let response, responseBytes = 0;
        try {
          const hopHeaders = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'content-length']);
          const headersToProvider = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !hopHeaders.has(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
          response = await fetchImpl('https://api.siliconflow.cn' + url.pathname + url.search, {
            method: req.method, redirect: 'error', signal: AbortSignal.timeout(providerTimeoutMs),
            headers: headersToProvider,
            ...(req.method === 'POST' ? {body} : {})
          });
          const headers = {'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store'};
          const retryAfter = response.headers.get('retry-after'); if (retryAfter) headers['Retry-After'] = retryAfter;
          if (!res.destroyed) { res.writeHead(response.status, headers); res.flushHeaders(); }
          // A disconnected consumer does not prematurely release the slot.
          for await (const chunk of response.body || []) {
            responseBytes += chunk.byteLength;
            if (!res.destroyed) res.write(chunk);
          }
          if (!res.destroyed) res.end();
          record('provider-end', {queueWaitMs, providerElapsedMs: performance.now() - acquiredAt,
            httpStatus: response.status, responseBytes, bodyFullyConsumed: true, rateLimited: response.status === 429});
          return {status: response.status, retry_after_seconds: retryAfter || 60};
        } catch (error) {
          record('provider-uncertain', {queueWaitMs, providerElapsedMs: performance.now() - acquiredAt,
            code: error.code || error.name, responseBytes, bodyFullyConsumed: false});
          writeJson(res, 502, {error: 'Provider request ended without confirmed complete consumption; shared slot retained'});
          return {status: 502, uncertain: true};
        }
      }, {label: 'worker-05 DSH fixed-model HTTP request'});
    } catch (error) {
      record('queue-error', {code: error.code || error.name});
      writeJson(res, 503, {error: 'Shared queue unavailable or AFK paused; no bypass is allowed'});
    }
  });
}
