import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { installFatalHandlers, notifyReady, onShutdownRequest, startHeartbeat } from './runtime/worker-guards.js';

let app: INestApplication | undefined;
const worker = process.env.TOOLING_WORKER_INDEX ?? '0';
const log = (message: string) => console.error(`[tooling ${worker}] ${message}`);

startHeartbeat();
installFatalHandlers(() => app, log);
onShutdownRequest(() => {
  setTimeout(() => process.exit(1), 10_000).unref();
  void (app ? app.close() : Promise.resolve()).then(
    () => process.exit(0),
    () => process.exit(1),
  );
});

try {
  const config = loadConfig();
  app = await createApp(config);
  const server = app.getHttpServer() as Server;
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  await app.listen(config.port, config.host);
  notifyReady();
  console.log(`[tooling ${worker}] à l'écoute sur http://${config.host}:${config.port} (auth ${config.authMode}, base ${config.database.kind})`);
} catch (error) {
  log(`Démarrage impossible : ${error instanceof Error ? error.message : String(error)}`);
  await app?.close().catch(() => undefined);
  process.exit(1);
}
