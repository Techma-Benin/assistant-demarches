import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { optionsFromEnv } from '../dev/agent-bridge.js';
import { startDevStack } from '../dev/stack.js';

const bridge = fileURLToPath(new URL('../dev/agent-bridge.js', import.meta.url));

test('pont : refuse toute cible hors localhost', async () => {
  assert.throws(() => optionsFromEnv({ TOOLING_URL: 'https://tooling.example.org' }), /localhost/);
  assert.throws(() => optionsFromEnv({ BACKEND_URL: 'http://10.0.0.5:4010' }), /localhost/);
  await assert.rejects(promisify(execFile)(process.execPath, [bridge], { env: { ...process.env, TOOLING_URL: 'https://tooling.example.org' } }), /localhost/);
});

test('pont : un agent stdio enchaîne des actions distinctes sans conflit d’idempotence', async (t) => {
  const stack = await startDevStack({ backend: 0, tooling: 0 });
  t.after(() => stack.close());
  const agent = new Client({ name: 'bridge-test', version: '1.0.0' });
  await agent.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bridge],
      env: { ...process.env, TOOLING_URL: stack.toolingUrl, BACKEND_URL: stack.backendUrl } as Record<string, string>,
      stderr: 'ignore',
    }),
  );
  t.after(() => agent.close());

  assert.match(agent.getInstructions() ?? '', /fileId « fil_[0-9A-Z]{26} »/);
  assert.equal((await agent.listTools()).tools.length, 9);
  const first = (await agent.callTool({ name: 'request.create', arguments: { procedureId: 'demo-procedure' } })) as unknown as { structuredContent: { id: string } };
  const second = (await agent.callTool({ name: 'request.create', arguments: { procedureId: 'demo-procedure' } })) as unknown as { structuredContent: { id: string } };
  assert.notEqual(first.structuredContent.id, second.structuredContent.id);
  for (const requestId of [first.structuredContent.id, second.structuredContent.id]) {
    const updated = (await agent.callTool({ name: 'request.update', arguments: { requestId, fields: { displayName: requestId } } })) as { isError?: boolean };
    assert.ok(!updated.isError);
  }
});
