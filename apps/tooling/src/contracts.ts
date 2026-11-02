import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';

const contractsDir = process.env.CONTRACTS_DIR
  ? pathToFileURL(join(resolve(process.env.CONTRACTS_DIR), sep))
  : new URL('../../../../contracts/v2/', import.meta.url);

const load = (file: string) => JSON.parse(readFileSync(new URL(file, contractsDir), 'utf8'));

export interface ToolDefinition {
  name: string;
  description: string;
  annotations: Record<string, boolean>;
  _meta: {
    'bj.techma/kind': 'read' | 'action';
    'bj.techma/requiresMandate': boolean;
    'bj.techma/requiresLogin'?: boolean;
    'bj.techma/scopes': string[];
  };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ToolContext {
  conversationId: string;
  userRef: string;
  mandateId?: string;
  traceId: string;
  channel?: 'web' | 'whatsapp';
  authenticated?: boolean;
}

export const domain = load('domain.schema.json') as { $id: string; $defs: Record<string, unknown> };
export const catalog = load('mcp.tools.json') as { version: string; tools: ToolDefinition[] };

const addFormats = addFormatsPlugin as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
ajv.addSchema(domain);
const sanitizer = addFormats(new Ajv2020({ allErrors: true, strict: false, removeAdditional: true }));
sanitizer.addSchema(domain);
function bindRefs(schema: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(schema).replaceAll('"#/$defs/', `"${domain.$id}#/$defs/`)) as Record<string, unknown>;
}

export function domainValidator(name: string): ValidateFunction {
  const validate = ajv.getSchema(`${domain.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Schéma inconnu : ${name}`);
  return validate;
}

export interface CompiledTool {
  definition: ToolDefinition;
  input: ValidateFunction;
  output: ValidateFunction;
}

export const tools = new Map<string, CompiledTool>(
  catalog.tools.map((definition) => [
    definition.name,
    { definition, input: ajv.compile(bindRefs(definition.inputSchema)), output: sanitizer.compile(bindRefs(definition.outputSchema)) },
  ]),
);

export function errorsText(validate: ValidateFunction): string {
  return ajv.errorsText(validate.errors, { dataVar: 'arguments' });
}
