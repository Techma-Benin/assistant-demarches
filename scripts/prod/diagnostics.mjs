import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const routeWords = new Set(('api auth login logout callback session health ready live v1 stream keycloak realms techma protocol openid-connect token certs resources _next static image photos admin operateur connexion demarches conversation conversations messages embed internal npi verify chat completions responses models').split(' '));
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** Never log query strings, filenames, account IDs, or arbitrary path values. */
export function safePath(url = '/') {
  const parts = String(url).split(/[?#]/, 1)[0].split('/').filter(Boolean);
  return '/' + parts.slice(0, 8).map((part) => routeWords.has(part) ? part : ':value').join('/')
    + (parts.length > 8 ? '/:more' : '');
}

/** Error messages/stacks may contain URLs, tokens, or submitted data. */
export function safeError(error) {
  const safe = (value) => typeof value === 'string' && /^[A-Za-z0-9_]{1,50}$/.test(value) ? value : undefined;
  return { name: safe(error?.name) || 'Error', code: safe(error?.code) || safe(error?.cause?.code) };
}

export function createDiagnostics({
  write = (line) => process.stdout.write(line),
  onDrain = (callback) => process.stdout.once('drain', callback),
  maxQueued = 200,
  bootId = randomUUID(), source = 'gateway',
} = {}) {
  let blocked = false;
  let dropped = 0;
  const queue = [];
  const record = (event, fields, level) => JSON.stringify({
    ...fields, timestamp: new Date().toISOString(), level, event, bootId, source, pid: process.pid,
  }) + '\n';
  const flush = () => {
    blocked = false;
    while (queue.length && !blocked) send(queue.shift());
  };
  const send = (line) => {
    if (blocked) {
      if (queue.length < maxQueued) queue.push(line);
      else dropped++;
      return;
    }
    try {
      if (write(line) === false) {
        blocked = true;
        onDrain(flush);
      }
    } catch { dropped++; }
  };
  return {
    bootId,
    emit: (event, fields = {}, level = 'info') => send(record(event, fields, level)),
    stats: () => ({ queuedLogLines: queue.length, droppedLogLines: dropped }),
  };
}

export function createRequestTracker({ emit, ready, stalledMs = 30_000, slowMs = 10_000 }) {
  const active = new Map();
  const counts = { started: 0, completed: 0, interrupted: 0 };
  function begin(req, transport = 'http', correlationId) {
    const requestId = correlationId || randomUUID();
    const started = performance.now();
    const state = {
      requestId, method: methods.has(req.method) ? req.method : 'OTHER',
      path: safePath(req.url), transport, phase: 'received', upstream: 'gateway', established: false,
    };
    let ended = false;
    const fields = () => ({
      ...state, elapsedMs: Math.round(performance.now() - started), ready: ready(),
    });
    counts.started++;
    emit('request.start', fields());
    const stalled = setInterval(() => emit('request.pending', fields(), 'warning'), stalledMs);
    stalled.unref();
    function end(outcome, extra = {}) {
      if (ended) return;
      ended = true;
      clearInterval(stalled);
      active.delete(requestId);
      if (outcome === 'complete') counts.completed++;
      else counts.interrupted++;
      emit('request.end', { ...fields(), ...extra, outcome },
        outcome !== 'complete' || (!state.established && performance.now() - started >= slowMs) ? 'warning' : 'info');
    }
    active.set(requestId, { state, fields, end });
    return {
      id: requestId,
      phase(phase, upstream = state.upstream, extra = {}) {
        if (ended) return;
        state.phase = phase; state.upstream = upstream;
        emit('request.phase', { ...fields(), ...extra });
      },
      error(event, error) {
        emit(event, { ...fields(), error: safeError(error) }, 'error');
      },
      established() {
        if (ended) return;
        state.established = true;
        clearInterval(stalled);
        emit('websocket.open', fields());
      },
      end,
    };
  }
  return {
    begin,
    snapshot() {
      const requests = [...active.values()];
      return {
        ...counts,
        activeHttp: requests.filter(({ state }) => state.transport === 'http').length,
        openWebSockets: requests.filter(({ state }) => state.established).length,
        pending: requests.filter(({ state }) => !state.established)
          .map(({ fields }) => fields()).sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 10),
      };
    },
    close() { for (const request of active.values()) request.end('gateway_shutdown'); },
  };
}
