import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const CONTRACTS = new URL('../contracts/v2/', import.meta.url);
export const load = (file) => JSON.parse(fs.readFileSync(new URL(file, CONTRACTS), 'utf8'));
export const domain = load('domain.schema.json');
export const catalog = load('mcp.tools.json');
export const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(domain);

export const valid = (name, value) => {
  const validate = ajv.getSchema(`${domain.$id}#/$defs/${name}`);
  if (!validate(value)) throw Object.assign(new Error(ajv.errorsText(validate.errors)), { code: 'INVALID_REQUEST' });
  return value;
};
export const validateEvent = (event) => {
  valid('Event', event);
  if (event.type !== `bj.techma.${event.data.kind}.v2`) throw new Error('Event type/data mismatch');
  return event;
};
