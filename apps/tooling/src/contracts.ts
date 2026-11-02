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
    'bj.techma/requiresLogin': boolean;
    'bj.techma/scopes': string[];
  };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ToolContext {
  conversationId: string;
  userRef: string;
  mandateId?: string;
  channel?: 'web' | 'whatsapp';
  traceId: string;
}

export const domain = load('domain.schema.json') as { $id: string; $defs: Record<string, unknown> };
export const catalog = load('mcp.tools.json') as { version: string; $defs: Record<string, unknown>; tools: ToolDefinition[] };

const addFormats = addFormatsPlugin as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
ajv.addSchema(domain);
const sanitizer = addFormats(new Ajv2020({ allErrors: true, strict: false, removeAdditional: true }));

export function domainValidator(name: string): ValidateFunction {
  const validate = ajv.getSchema(`${domain.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Schéma inconnu : ${name}`);
  return validate;
}

export function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  return ajv.compile(schema);
}

export interface CompiledTool {
  definition: ToolDefinition;
  input: ValidateFunction;
  output: ValidateFunction;
}

const withDefs = (schema: Record<string, unknown>) => ({ ...schema, $defs: catalog.$defs });

function referencedDefs(schema: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const item of schema) referencedDefs(item, found);
  else if (schema && typeof schema === 'object') {
    for (const [key, value] of Object.entries(schema)) {
      const name = key === '$ref' && typeof value === 'string' ? /^#\/\$defs\/(.+)$/.exec(value)?.[1] : undefined;
      if (name && !found.has(name)) {
        found.add(name);
        referencedDefs(catalog.$defs[name], found);
      } else referencedDefs(value, found);
    }
  }
  return found;
}

function selfContained(schema: Record<string, unknown>): Record<string, unknown> {
  const names = [...referencedDefs(schema)].sort();
  const object = { type: 'object', ...schema };
  return names.length ? { ...object, $defs: Object.fromEntries(names.map((name) => [name, catalog.$defs[name]])) } : object;
}

export const listedTools = catalog.tools.map((tool) => ({ ...tool, inputSchema: selfContained(tool.inputSchema), outputSchema: selfContained(tool.outputSchema) }));

export const tools = new Map<string, CompiledTool>(
  catalog.tools.map((definition) => [
    definition.name,
    { definition, input: ajv.compile(withDefs(definition.inputSchema)), output: sanitizer.compile(withDefs(definition.outputSchema)) },
  ]),
);

const conversationId = domainValidator('ConversationId');
const userRef = domainValidator('UserRef');
const mandateId = domainValidator('MandateId');
const channel = domainValidator('Channel');

export function validContext(context: ToolContext): boolean {
  return (
    conversationId(context.conversationId) === true &&
    userRef(context.userRef) === true &&
    (context.mandateId === undefined || mandateId(context.mandateId) === true) &&
    (context.channel === undefined || channel(context.channel) === true)
  );
}

export function errorsText(validate: ValidateFunction): string {
  return ajv.errorsText(validate.errors, { dataVar: 'arguments' });
}
