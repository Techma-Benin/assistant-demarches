import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export interface DevStack {
  backendUrl: string;
  toolingUrl: string;
  close(): Promise<void>;
}

const repoRoot = new URL('../../../../', import.meta.url);

export async function startDevStack(ports: { backend: number; tooling: number } = { backend: 4010, tooling: 4030 }): Promise<DevStack> {
  const { startMocks } = await import(new URL('mocks/server.mjs', repoRoot).href);
  const mocks = await startMocks({ backendPort: ports.backend, toolingPort: 0 });
  let app: INestApplication | undefined;
  try {
    app = await createApp(loadConfig({ AUTH_MODE: 'mock-tokens', BACKEND_URL: mocks.backendUrl, TOOLING_PORT: String(ports.tooling), EVENTS_PUBLISHER: 'off' }));
    await app.listen(ports.tooling, '127.0.0.1');
  } catch (error) {
    await mocks.close();
    throw error;
  }
  const port = (app.getHttpServer().address() as AddressInfo).port;
  return {
    backendUrl: mocks.backendUrl,
    toolingUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await app?.close();
      await mocks.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stack = await startDevStack();
  console.log(`Backend simulé : ${stack.backendUrl}`);
  console.log(`Tooling réel   : ${stack.toolingUrl}/mcp (jetons de simulation, PGlite en mémoire)`);
  console.log('Pont pour un agent : node apps/tooling/dist/dev/agent-bridge.js');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stack.close().then(() => process.exit(0));
    });
  }
}
