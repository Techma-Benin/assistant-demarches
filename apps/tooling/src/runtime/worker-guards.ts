import type { INestApplication } from '@nestjs/common';
import type { WorkerMessage } from './supervisor.js';

export function startHeartbeat(intervalMs = 5000): void {
  if (!process.send) return;
  const beat = () => process.send?.({ type: 'heartbeat' } satisfies WorkerMessage);
  beat();
  setInterval(beat, intervalMs).unref();
}

export function notifyReady(): void {
  process.send?.({ type: 'ready' } satisfies WorkerMessage);
}

export function installFatalHandlers(getApp: () => INestApplication | undefined, log: (message: string) => void): void {
  let exiting = false;
  const fatal = (kind: string, error: unknown) => {
    log(`${kind} : ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    if (exiting) return;
    exiting = true;
    setTimeout(() => process.exit(1), 10_000).unref();
    const app = getApp();
    void (app ? app.close() : Promise.resolve()).catch(() => undefined).finally(() => process.exit(1));
  };
  process.on('uncaughtException', (error) => fatal('Exception non rattrapée', error));
  process.on('unhandledRejection', (reason) => fatal('Promesse rejetée sans gestionnaire', reason));
}
