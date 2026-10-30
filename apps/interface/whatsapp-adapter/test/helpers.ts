import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Logger, type LoggerService } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { AppConfig } from '../src/config/config.js';
import type { ContractEvent } from '../src/contracts/types.js';
import { signBody } from '../src/webhook/signature.js';
import type { WaMessage } from '../src/webhook/payload.js';
import type { OutboundJob, OutboundQueue } from '../src/meta/outbound-queue.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const CONTRACTS_DIR = `${REPO_ROOT}contracts/v1`;
export const APP_SECRET = 'test-app-secret';
export const VERIFY_TOKEN = 'test-verify-token';
export const WA_ID = '22961234567';
export const TRACEPARENT = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;

export function testConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    nodeEnv: 'test',
    isProduction: false,
    backendUrl: 'http://127.0.0.1:4010',
    meta: { appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN, graphVersion: 'v23.0', useGraphApi: false },
    subjectHmacKey: 'k'.repeat(40),
    callback: {},
    mockUserToken: 'mock-user',
    contractsDir: CONTRACTS_DIR,
    ...over,
  };
}

export async function buildApp(
  options: { config?: AppConfig; overrides?: Record<string, unknown>; logger?: LoggerService | false } = {},
): Promise<NestExpressApplication> {
  const config = options.config ?? testConfig();
  let builder = Test.createTestingModule({ imports: [AppModule.register(config)] });
  for (const [token, value] of Object.entries(options.overrides ?? {})) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: options.logger ?? false });
  configureApp(app, config);
  await app.init();
  return app;
}

/** Coupe les journaux Nest pendant les tests (sauf si un test installe son propre logger). */
export const silenceLogs = () => Logger.overrideLogger(false);

export const fixtureEvent = (): ContractEvent =>
  (JSON.parse(readFileSync(`${REPO_ROOT}mocks/fixtures.json`, 'utf8')) as { event: ContractEvent }).event;

export const sign = (raw: string | Buffer): string => signBody(APP_SECRET, raw);

export const waText = (body: string, id = 'wamid.TEST1', from = WA_ID): WaMessage => ({
  from,
  id,
  timestamp: '1760000000',
  type: 'text',
  text: { body },
});

export const metaPayload = (messages: WaMessage[]) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'PNID', display_phone_number: '15550000000' },
            contacts: [{ wa_id: WA_ID, profile: { name: 'Test' } }],
            messages,
          },
        },
      ],
    },
  ],
});

/** File d’envoi factice : conserve les tâches pour inspection. */
export class RecordingOutboundQueue implements OutboundQueue {
  readonly jobs: OutboundJob[] = [];
  enqueue(job: OutboundJob): void {
    this.jobs.push(job);
  }
  /** Exécute `prepare()` de chaque tâche et renvoie les cibles. */
  async targets() {
    return Promise.all(this.jobs.map((j) => j.prepare()));
  }
}

export const textsOf = (target: Awaited<ReturnType<OutboundJob['prepare']>>): string[] =>
  (target?.messages ?? []).map((m) => (m.type === 'text' ? m.text.body : m.interactive.body.text));

/** Charge un schéma du contrat pour valider les corps de réponse. */
const interop = <T>(mod: unknown): T => ((mod as { default?: T }).default ?? mod) as T;

export function contractValidator(defName: string) {
  const Ajv2020 = interop<typeof Ajv2020Module.default>(Ajv2020Module);
  const addFormats = interop<typeof addFormatsModule.default>(addFormatsModule);
  const domain = JSON.parse(readFileSync(`${CONTRACTS_DIR}/domain.schema.json`, 'utf8')) as { $id: string };
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  ajv.addSchema(domain);
  return ajv.getSchema(`${domain.$id}#/$defs/${defName}`)!;
}
