import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';

const contractsDir = process.env.CONTRACTS_DIR
  ? pathToFileURL(join(resolve(process.env.CONTRACTS_DIR), sep))
  : new URL('../../../../contracts/v2/', import.meta.url);

export const domain = JSON.parse(readFileSync(new URL('domain.schema.json', contractsDir), 'utf8')) as { $id: string; $defs: Record<string, unknown> };

const addFormats = addFormatsPlugin as unknown as (ajv: Ajv2020) => Ajv2020;
export const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
ajv.addSchema(domain);

export function domainValidator(name: string): ValidateFunction {
  const validate = ajv.getSchema(`${domain.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Schéma inconnu : ${name}`);
  return validate;
}

export function errorsText(validate: ValidateFunction): string {
  return ajv.errorsText(validate.errors, { dataVar: 'corps' });
}
