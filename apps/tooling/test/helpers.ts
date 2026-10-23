import { readFileSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

// Compilé dans apps/tooling/dist/test : la racine du dépôt est quatre niveaux plus haut.
const repoRoot = new URL('../../../../', import.meta.url);
const domain = JSON.parse(readFileSync(new URL('contracts/v1/domain.schema.json', repoRoot), 'utf8'));
const addFormats = addFormatsPlugin as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
ajv.addSchema(domain);

/** Valide une valeur contre une définition partagée de domain.schema.json. */
export function assertSchema(name: string, value: unknown): void {
  const validate = ajv.getSchema(`${domain.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Schéma inconnu : ${name}`);
  if (!validate(value)) throw new Error(`${name} : ${ajv.errorsText(validate.errors)}`);
}

export const TRACEPARENT = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;

/** Démarre le service sur un port libre et l'arrête à la fin du test. */
export async function startTooling(t: TestContext, env: NodeJS.ProcessEnv = {}): Promise<string> {
  const app = await createApp(loadConfig({ TOOLING_PORT: '0', ...env }));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const address = app.getHttpServer().address();
  return `http://127.0.0.1:${address.port}`;
}
