import { readdir, readFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { safeError } from './diagnostics.mjs';

/** Only process names/counters are read: command lines can contain DB credentials. */
export async function processSnapshot() {
  try {
    const entries = await readdir('/proc');
    const rows = (await Promise.all(entries.filter((entry) => /^\d+$/.test(entry)).map(async (entry) => {
      try {
        const text = await readFile(`/proc/${entry}/status`, 'utf8');
        const field = (name) => text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1];
        return {
          pid: Number(entry), parentPid: Number(field('PPid')),
          name: (field('Name') || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40),
          rssMb: Math.round(Number(field('VmRSS')?.split(' ')[0] || 0) / 1024),
          threads: Number(field('Threads') || 0),
          state: (field('State') || '').slice(0, 1),
        };
      } catch { return null; }
    }))).filter(Boolean);
    const family = new Set([process.pid]);
    let changed;
    do {
      changed = false;
      for (const row of rows) if (family.has(row.parentPid) && !family.has(row.pid)) {
        family.add(row.pid); changed = true;
      }
    } while (changed);
    return rows.filter((row) => family.has(row.pid)).slice(0, 50);
  } catch (error) {
    return { unavailable: safeError(error) };
  }
}

async function cgroupMemory() {
  const result = {};
  for (const name of ['memory.current', 'memory.max', 'memory.events']) {
    try {
      const value = (await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim();
      if (name === 'memory.events') {
        result.events = Object.fromEntries(value.split('\n').map((line) => {
          const [key, count] = line.split(/\s+/); return [key, Number(count)];
        }));
      } else result[name === 'memory.current' ? 'currentBytes' : 'limitBytes'] = value === 'max' ? 'unlimited' : Number(value);
    } catch { /* Some VM/container hosts do not expose cgroup v2. */ }
  }
  return result;
}

export async function probeService({ name, url, method = 'GET' }, emit, timeoutMs = 2000) {
  const started = performance.now();
  try {
    const response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    const result = { service: name, status: response.status, elapsedMs: Math.round(performance.now() - started) };
    emit('service.probe', result, response.ok ? 'info' : 'warning');
    return result;
  } catch (error) {
    const result = { service: name, elapsedMs: Math.round(performance.now() - started), error: safeError(error) };
    emit('service.probe', result, 'error');
    return result;
  }
}

export function startRuntimeDiagnostics({
  diagnostics, gateway, state, services, intervalMs = 15_000, probeIntervalMs = 30_000,
}) {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let previousTime = performance.now();
  let previousCpu = process.cpuUsage();
  let sampling = false;
  let probing = false;
  let closed = false;
  async function sample() {
    if (sampling || closed) return;
    sampling = true;
    try {
      const now = performance.now();
      const elapsedMs = now - previousTime;
      const cpu = process.cpuUsage(previousCpu);
      previousCpu = process.cpuUsage(); previousTime = now;
      const memory = process.memoryUsage();
      const processes = await processSnapshot();
      if (closed) return;
      diagnostics.emit('runtime.heartbeat', {
        ...state(), uptimeSeconds: Math.round(process.uptime()),
        heartbeatGapMs: Math.round(elapsedMs),
        eventLoopMaxMs: Math.round(delay.max / 1e6),
        eventLoopP99Ms: Math.round(delay.percentile(99) / 1e6),
        gatewayCpuCorePercent: Math.round((cpu.user + cpu.system) / Math.max(1, elapsedMs)) / 10,
        gatewayRssMb: Math.round(memory.rss / 1024 / 1024),
        gatewayHeapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        processes, cgroupMemory: await cgroupMemory(),
        requests: gateway.diagnosticsSnapshot(), logs: diagnostics.stats(),
      });
      delay.reset();
    } catch (error) {
      diagnostics.emit('runtime.sample_error', { error: safeError(error) }, 'error');
    } finally { sampling = false; }
  }
  async function probe() {
    if (probing || closed) return;
    probing = true;
    try {
      await Promise.all(services.map((service) => probeService(service, diagnostics.emit)));
    } finally { probing = false; }
  }
  const heartbeat = setInterval(() => void sample(), intervalMs);
  const probes = setInterval(() => void probe(), probeIntervalMs);
  heartbeat.unref(); probes.unref();
  void sample();
  return () => {
    closed = true;
    clearInterval(heartbeat); clearInterval(probes); delay.disable();
  };
}
