import cluster, { type Worker } from 'node:cluster';

export interface SupervisorOptions {
  workers: number;
  exec: string;
  heartbeatTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  shutdownTimeoutMs?: number;
  handleSignals?: boolean;
  log?: (message: string) => void;
}

export interface WorkerMessage {
  type: 'heartbeat' | 'ready';
}

export interface ControlMessage {
  type: 'shutdown';
}

export const isShutdown = (message: unknown): boolean => (message as ControlMessage | undefined)?.type === 'shutdown';

interface Slot {
  index: number;
  worker?: Worker;
  crashes: number[];
  lastBeat: number;
  restartTimer?: NodeJS.Timeout;
}

export interface Supervisor {
  pids(): number[];
  stop(): Promise<void>;
}

const CRASH_WINDOW_MS = 60_000;

export function supervise(options: SupervisorOptions): Supervisor {
  const heartbeatTimeout = options.heartbeatTimeoutMs ?? 30_000;
  const base = options.baseBackoffMs ?? 1000;
  const max = options.maxBackoffMs ?? 30_000;
  const log = options.log ?? ((message: string) => console.log(`[superviseur] ${message}`));
  let stopping = false;

  cluster.setupPrimary({ exec: options.exec });
  const slots: Slot[] = Array.from({ length: options.workers }, (_, index) => ({ index, crashes: [], lastBeat: 0 }));

  const spawn = (slot: Slot): void => {
    const worker = cluster.fork({ TOOLING_WORKER_INDEX: String(slot.index) });
    slot.worker = worker;
    slot.lastBeat = Date.now();
    log(`processus ${slot.index} lancé (pid ${worker.process.pid})`);
    worker.on('message', (message: WorkerMessage) => {
      if (message?.type === 'heartbeat' || message?.type === 'ready') slot.lastBeat = Date.now();
      if (message?.type === 'ready') log(`processus ${slot.index} prêt (pid ${worker.process.pid})`);
    });
    worker.on('error', (error) => log(`processus ${slot.index} : ${error.message}`));
    worker.on('exit', (code, signal) => {
      if (slot.worker !== worker) return;
      slot.worker = undefined;
      if (stopping) return;
      const now = Date.now();
      slot.crashes = slot.crashes.filter((at) => now - at < CRASH_WINDOW_MS);
      slot.crashes.push(now);
      const delay = Math.min(base * 2 ** (slot.crashes.length - 1), max);
      log(`processus ${slot.index} arrêté (code ${code ?? '-'}, signal ${signal ?? '-'}) ; relance dans ${delay} ms`);
      slot.restartTimer = setTimeout(() => {
        if (!stopping) spawn(slot);
      }, delay);
    });
  };

  slots.forEach(spawn);

  const watchdog = setInterval(() => {
    for (const slot of slots) {
      if (slot.worker && Date.now() - slot.lastBeat > heartbeatTimeout) {
        log(`processus ${slot.index} ne répond plus depuis ${heartbeatTimeout} ms : remplacé`);
        slot.lastBeat = Date.now();
        slot.worker.process.kill('SIGKILL');
      }
    }
  }, Math.min(1000, heartbeatTimeout / 2));

  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(watchdog);
    const running = slots.flatMap((slot) => {
      clearTimeout(slot.restartTimer);
      return slot.worker ? [slot.worker] : [];
    });
    await Promise.all(
      running.map(
        (worker) =>
          new Promise<void>((resolve) => {
            if (worker.isDead()) return resolve();
            const force = setTimeout(() => worker.process.kill('SIGKILL'), options.shutdownTimeoutMs ?? 15_000);
            worker.once('exit', () => {
              clearTimeout(force);
              resolve();
            });
            if (worker.isConnected()) worker.send({ type: 'shutdown' } satisfies ControlMessage);
            else worker.process.kill('SIGKILL');
          }),
      ),
    );
    log('arrêt terminé');
  };

  if (options.handleSignals ?? true) {
    const shutdown = (reason: string) => {
      log(`${reason} : arrêt des processus`);
      void stop().then(() => process.exit(0));
    };
    const signals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : ['SIGTERM', 'SIGINT'];
    for (const signal of signals) process.once(signal, () => shutdown(`${signal} reçu`));
    if (process.send) {
      process.on('message', (message) => {
        if (isShutdown(message)) shutdown('demande d\'arrêt reçue');
      });
    }
  }

  return {
    pids: () => slots.flatMap((slot) => (slot.worker?.process.pid ? [slot.worker.process.pid] : [])),
    stop,
  };
}
