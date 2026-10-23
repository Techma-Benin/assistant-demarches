import type { INestApplication } from '@nestjs/common';
import { isShutdown, type WorkerMessage } from './supervisor.js';

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

export function onShutdownRequest(handler: () => void): void {
  if (!process.send) return;
  let requested = false;
  const once = () => {
    if (requested) return;
    requested = true;
    handler();
  };
  process.on('message', (message) => {
    if (isShutdown(message)) once();
  });
  process.on('disconnect', once);
}
