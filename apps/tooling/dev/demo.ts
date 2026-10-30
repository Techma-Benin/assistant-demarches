import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ConnectorWorker } from '../src/connectors/connector-worker.js';
import { startDevStack } from './stack.js';

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
}

let failures = 0;
const line = (status: string, step: string, detail: string) => console.log(`${status.padEnd(6)} ${step.padEnd(44)} ${detail}`);

function expect(step: string, ok: boolean, detail: string): void {
  line(ok ? 'ok' : 'ÉCHEC', step, detail);
  if (!ok) failures += 1;
}

const errorCode = (result: ToolResult) => (result.isError ? (JSON.parse(result.content[0].text) as { code: string }).code : undefined);

async function run(): Promise<void> {
  const stack = await startDevStack({ backend: 0, tooling: 0 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./agent-bridge.js', import.meta.url))],
    env: { ...process.env, TOOLING_URL: stack.toolingUrl, BACKEND_URL: stack.backendUrl } as Record<string, string>,
    stderr: 'pipe',
  });
  const bridgeLog: string[] = [];
  transport.stderr?.on('data', (chunk: Buffer) => bridgeLog.push(...chunk.toString().trim().split('\n')));
  const agent = new Client({ name: 'demo-agent', version: '1.0.0' });
  const call = async (name: string, args: Record<string, unknown>) => (await agent.callTool({ name, arguments: args })) as ToolResult;

  try {
    console.log('Démonstration : un agent MCP passe par le pont, qui relaie vers le vrai service Tooling.\n');
    await agent.connect(transport);
    const instructions = agent.getInstructions() ?? '';
    const fileId = /fileId « (fil_[0-9A-Z]{26}) »/.exec(instructions)?.[1];
    expect('connexion au pont (stdio)', true, `serveur ${agent.getServerVersion()?.name}`);
    expect('consignes reçues par l’agent', !!fileId, fileId ? `pièce synthétique ${fileId}` : 'aucune pièce');

    const { tools } = await agent.listTools();
    expect('tools/list', tools.length === 9, tools.map((tool) => tool.name).join(', '));

    const search = await call('procedures.search', { query: 'demo', locale: 'fr' });
    const items = (search.structuredContent?.items ?? []) as { id: string; title: string }[];
    expect('procedures.search « demo »', items.length === 1, items.map((item) => `${item.id} : ${item.title}`).join(', '));

    const procedure = await call('procedures.get', { procedureId: 'demo-procedure' });
    const required = procedure.structuredContent?.requiredDocuments as string[] | undefined;
    expect('procedures.get', !!required, `pièces requises : ${required?.join(', ')}`);

    const created = await call('request.create', { procedureId: 'demo-procedure' });
    const requestId = created.structuredContent?.id as string;
    expect('request.create', created.structuredContent?.status === 'draft', `${requestId}, statut draft`);

    const second = await call('request.create', { procedureId: 'demo-procedure' });
    expect('request.create, seconde demande', !!second.structuredContent?.id && second.structuredContent.id !== requestId, 'nouvelle demande : chaque appel a sa propre clé');

    const forbidden = await call('request.update', { requestId, fields: { npi: '1234567890' } });
    expect('request.update avec un NPI', errorCode(forbidden) === 'INVALID_REQUEST', 'refusé : donnée d’identité interdite');

    const updated = await call('request.update', { requestId, fields: { displayName: 'Usager fictif' } });
    expect('request.update displayName', updated.structuredContent?.status === 'draft', 'champ enregistré, pièce encore manquante');

    const early = await call('request.submit', { requestId });
    expect('request.submit trop tôt', errorCode(early) === 'REQUEST_INCOMPLETE', 'refusé : pièce manquante');

    const attached = await call('documents.attach', { requestId, fileId, documentType: 'demo-document' });
    expect('documents.attach', attached.structuredContent?.status === 'ready', 'statut ready');

    const verified = await call('documents.verify', { requestId, fileId });
    expect('documents.verify', verified.structuredContent?.status === 'valid', 'pièce valide (contrôle technique)');

    const submitted = await call('request.submit', { requestId });
    expect('request.submit', submitted.structuredContent?.status === 'awaiting_user_validation', `lien officiel : ${submitted.structuredContent?.officialLink}`);

    const status = await call('request.status', { requestId });
    expect('request.status', status.structuredContent?.status === 'awaiting_user_validation', 'l’usager termine sur le portail officiel');

    const late = await call('request.update', { requestId, fields: { displayName: 'Autre' } });
    expect('request.update après préparation', errorCode(late) === 'INVALID_TRANSITION', 'refusé : demande figée');

    console.log('\nJournal du pont :');
    for (const entry of bridgeLog) console.log(`  ${entry}`);
  } finally {
    await agent.close().catch(() => undefined);
    await stack.close();
  }
  await runConnector();
  console.log(failures ? `\n${failures} étape(s) en échec.` : '\nToutes les étapes ont réussi.');
  process.exitCode = failures ? 1 : 0;
}

async function runConnector(): Promise<void> {
  console.log('\nSuite : connecteur SIMULÉ. Statuts fictifs, jamais activé en production ni dans la démonstration officielle.\n');
  const stack = await startDevStack({ backend: 0, tooling: 0 }, { CONNECTORS: 'simulated', CONNECTOR_WORKER: 'off', CONNECTOR_POLL_MS: '20', CONNECTOR_SIMULATED_STEP_MS: '200' });
  const agent = new Client({ name: 'demo-agent-connecteur', version: '1.0.0' });
  const call = async (name: string, args: Record<string, unknown>) => (await agent.callTool({ name, arguments: args })) as ToolResult;
  try {
    await agent.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('./agent-bridge.js', import.meta.url))],
        env: { ...process.env, TOOLING_URL: stack.toolingUrl, BACKEND_URL: stack.backendUrl } as Record<string, string>,
        stderr: 'ignore',
      }),
    );
    const fileId = /fileId « (fil_[0-9A-Z]{26}) »/.exec(agent.getInstructions() ?? '')?.[1];
    const requestId = (await call('request.create', { procedureId: 'demo-procedure' })).structuredContent?.id as string;
    await call('request.update', { requestId, fields: { displayName: 'Usager fictif' } });
    await call('documents.attach', { requestId, fileId, documentType: 'demo-document' });
    const submitted = await call('request.submit', { requestId });
    expect('request.submit (envoi mis en file)', submitted.structuredContent?.status === 'awaiting_user_validation', 'l’agent a terminé, le Tooling prend le relais');

    const worker = stack.app.get(ConnectorWorker);
    const steps: [string, string, number][] = [
      ['envoi à l’administration', 'submitted', 0],
      ['suivi : dossier en traitement', 'processing', 220],
      ['suivi : dossier terminé', 'completed', 220],
    ];
    for (const [label, expected, wait] of steps) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      await worker.tick();
      const status = (await call('request.status', { requestId })).structuredContent?.status;
      expect(label, status === expected, `statut ${status}`);
    }
  } finally {
    await agent.close().catch(() => undefined);
    await stack.close();
  }
}

run().catch((error: unknown) => {
  console.error(`Démonstration interrompue : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
