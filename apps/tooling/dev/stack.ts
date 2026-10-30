import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export interface DevStack {
  backendUrl: string;
  toolingUrl: string;
  app: INestApplication;
  close(): Promise<void>;
}

const repoRoot = new URL('../../../../', import.meta.url);

export async function startDevStack(ports: { backend: number; tooling: number } = { backend: 4010, tooling: 4030 }, env: NodeJS.ProcessEnv = {}): Promise<DevStack> {
  const { startMocks } = await import(new URL('mocks/server.mjs', repoRoot).href);
  const mocks = await startMocks({ backendPort: ports.backend, toolingPort: 0 });
  let app: INestApplication | undefined;
  try {
    app = await createApp(loadConfig({ AUTH_MODE: 'mock-tokens', BACKEND_URL: mocks.backendUrl, TOOLING_PORT: String(ports.tooling), EVENTS_PUBLISHER: 'off', ...env }));
    await app.listen(ports.tooling, '127.0.0.1');
  } catch (error) {
    await mocks.close();
    throw error;
  }
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const started = app;
  return {
    backendUrl: mocks.backendUrl,
    toolingUrl: `http://127.0.0.1:${port}`,
    app: started,
    close: async () => {
      await app?.close();
      await mocks.close();
    },
  };
}

/** The simulated X-Road (apps/xroad-sim, built by the dev:stack script), with its fictitious history. */
async function startXroad(port: number): Promise<{ url: string; close(): Promise<void> }> {
  const { createXroadServer } = await import(new URL('apps/xroad-sim/dist/src/server.js', repoRoot).href);
  const { loadConfig: loadSimConfig } = await import(new URL('apps/xroad-sim/dist/src/config.js', repoRoot).href);
  return createXroadServer(loadSimConfig({ XROAD_PORT: String(port) })).listen();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wantXroad = process.env.XROAD === 'on' || (process.env.XROAD !== 'off' && !process.env.CONNECTORS);
  const xroad = wantXroad ? await startXroad(4040) : undefined;
  const connectors = xroad
    ? { XROAD_URL: xroad.url, PROCEDURES_SOURCE: 'xroad', CONNECTORS: 'xroad', CONNECTOR_INTERVAL_MS: '1000', CONNECTOR_POLL_MS: '3000' }
    : process.env.CONNECTORS
      ? { CONNECTORS: process.env.CONNECTORS }
      : {};
  const stack = await startDevStack(undefined, connectors);
  console.log(`Backend simulé : ${stack.backendUrl}`);
  if (xroad) console.log(`X-Road simulé  : ${xroad.url} (vue des connexions sur ${xroad.url}/, fiches et dossiers fictifs)`);
  else if (connectors.CONNECTORS) console.log(`Connecteurs : ${connectors.CONNECTORS} (SIMULATION, statuts fictifs)`);
  console.log(`Tooling réel   : ${stack.toolingUrl}/mcp (jetons de simulation, PGlite en mémoire)`);
  console.log('Pont pour un agent : node apps/tooling/dist/dev/agent-bridge.js');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stack
        .close()
        .then(() => xroad?.close())
        .then(() => process.exit(0));
    });
  }
}
