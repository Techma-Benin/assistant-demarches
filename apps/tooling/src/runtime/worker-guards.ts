import type { INestApplication } from '@nestjs/common';
import type { WorkerMessage } from './supervisor.js';

/** Battement de cœur vers le superviseur : il s'arrête si la boucle d'événements est bloquée. */
export function startHeartbeat(intervalMs = 5000): void {
  if (!process.send) return;
  const beat = () => process.send?.({ type: 'heartbeat' } satisfies WorkerMessage);
  beat();
  setInterval(beat, intervalMs).unref();
}

export function notifyReady(): void {
  process.send?.({ type: 'ready' } satisfies WorkerMessage);
}

/**
 * Après une exception non rattrapée, l'état du processus n'est plus fiable : on ferme
 * proprement ce qui peut l'être, puis on sort en échec pour être remplacé.
 */
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
