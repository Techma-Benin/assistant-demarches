import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

let app: INestApplication | undefined;
const log = (message: string) => console.error(`[tooling] ${message}`);

const shutdown = (code: number) => {
  setTimeout(() => process.exit(1), 10_000).unref();
  void (app ? app.close() : Promise.resolve()).then(() => process.exit(code), () => process.exit(1));
};
process.on('uncaughtException', (error) => {
  log(`Exception non rattrapée : ${error.stack ?? error.message}`);
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  log(`Promesse rejetée sans gestionnaire : ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  shutdown(1);
});

try {
  const config = loadConfig();
  app = await createApp(config);
  const server = app.getHttpServer() as Server;
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  await app.listen(config.port, config.host);
  console.log(`[tooling] à l'écoute sur http://${config.host}:${config.port}`);
} catch (error) {
  log(`Démarrage impossible : ${error instanceof Error ? error.message : String(error)}`);
  await app?.close().catch(() => undefined);
  process.exit(1);
}
