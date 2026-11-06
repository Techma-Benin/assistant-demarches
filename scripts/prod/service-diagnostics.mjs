import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createDiagnostics, createRequestTracker, safeError } from './diagnostics.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const privateServices = new Map([
  ['3100', 'interface'], ['4110', 'backend'], ['4130', 'tooling'], ['4140', 'xroad'], ['8181', 'keycloak'],
]);

/** Native diagnostic channels observe HTTP without replacing framework handlers. */
export function installServiceDiagnostics({ diagnostics, publicOrigin, intervalMs = 15_000 }) {
  const { emit } = diagnostics;
  const tracker = createRequestTracker({ emit, ready: () => undefined });
  const outgoing = new WeakMap();
  const subscriptions = [];
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  function watch(channel, handler) {
    const guarded = (message) => {
      try { handler(message); }
      catch (error) { emit('service.observer_error', { error: safeError(error) }, 'error'); }
    };
    subscribe(channel, guarded); subscriptions.push([channel, guarded]);
  }
  function target(origin) {
    try {
      const url = new URL(origin);
      if (url.origin === publicOrigin) return 'public_origin';
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return privateServices.get(url.port) || 'local_service';
      return url.hostname === 'api.openai.com' ? 'openai' : 'external_service';
    } catch { return 'unknown'; }
  }
  function startOutgoing(request, origin, path) {
    const trace = tracker.begin({ method: request.method, url: path }, 'outbound');
    trace.phase('outbound_start', target(origin));
    outgoing.set(request, trace);
    return trace;
  }
  watch('http.server.request.start', ({ request, response }) => {
    const supplied = request.headers['x-request-id'];
    const trace = tracker.begin(request, 'http', typeof supplied === 'string' && uuid.test(supplied) ? supplied : undefined);
    response.once('finish', () => trace.end('complete', { status: response.statusCode }));
    response.once('close', () => {
      if (!response.writableFinished) trace.end('client_aborted');
    });
    request.once('aborted', () => trace.end('client_aborted'));
  });
  watch('http.client.request.start', ({ request }) => {
    const host = request.getHeader('host') || request.host || 'localhost';
    const trace = startOutgoing(request, `${request.protocol || 'http:'}//${host}`, request.path);
    request.once('response', (response) => {
      trace.phase('upstream_headers', undefined, { status: response.statusCode });
      response.once('end', () => trace.end('complete', { status: response.statusCode }));
      response.once('aborted', () => trace.end('response_aborted'));
      response.once('error', (error) => { trace.error('request.outbound_error', error); trace.end('outbound_error'); });
    });
    request.once('error', (error) => { trace.error('request.outbound_error', error); trace.end('outbound_error'); });
    request.once('close', () => { if (!request.res) trace.end('connection_closed'); });
  });
  watch('undici:request:create', ({ request }) => startOutgoing(request, request.origin, request.path));
  watch('undici:request:headers', ({ request, response }) => outgoing.get(request)?.phase('upstream_headers', undefined, { status: response.statusCode }));
  watch('undici:request:trailers', ({ request }) => outgoing.get(request)?.end('complete'));
  watch('undici:request:error', ({ request, error }) => {
    const trace = outgoing.get(request);
    trace?.error('request.outbound_error', error); trace?.end('outbound_error');
  });
  let previousTime = performance.now();
  let previousCpu = process.cpuUsage();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    const elapsed = now - previousTime;
    const cpu = process.cpuUsage(previousCpu);
    previousTime = now; previousCpu = process.cpuUsage();
    const memory = process.memoryUsage();
    emit('service.heartbeat', {
      heartbeatGapMs: Math.round(elapsed),
      cpuCorePercent: Math.round((cpu.user + cpu.system) / Math.max(1, elapsed)) / 10,
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      eventLoopMaxMs: Math.round(delay.max / 1e6),
      eventLoopP99Ms: Math.round(delay.percentile(99) / 1e6),
      requests: tracker.snapshot(), logs: diagnostics.stats(),
    });
    delay.reset();
  }, intervalMs);
  heartbeat.unref();
  emit('service.observer_ready');
  return () => {
    clearInterval(heartbeat); delay.disable();
    for (const [channel, handler] of subscriptions) unsubscribe(channel, handler);
    tracker.close();
  };
}

const service = process.env.SHOWCASE_DIAGNOSTICS_SERVICE;
if (['interface', 'backend', 'tooling', 'xroad'].includes(service)) {
  const bootId = process.env.SHOWCASE_DIAGNOSTICS_BOOT_ID;
  const diagnostics = createDiagnostics({
    source: service, ...(uuid.test(bootId || '') ? { bootId } : {}),
  });
  installServiceDiagnostics({ diagnostics, publicOrigin: process.env.SHOWCASE_PUBLIC_URL?.replace(/\/$/, '') });
  process.on('uncaughtExceptionMonitor', (error) => diagnostics.emit('service.uncaught_exception', { error: safeError(error) }, 'error'));
}
