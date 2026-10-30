// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { fixtures } from '@/dev/fixtures';

const schemaPath = fileURLToPath(new URL('../../../../contracts/v1/domain.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

describe('dev fixtures', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  ajv.addSchema(schema, 'domain');
  const validate = ajv.compile({ $ref: 'domain#/$defs/AgentMessage' });

  it('covers all block types', () => {
    const types = new Set(fixtures.flatMap((m) => m.blocks.map((b) => b.type)));
    expect([...types].sort()).toEqual(['buttons', 'fileRequest', 'form', 'statusCard', 'text']);
  });

  it.each(fixtures.map((f, i) => [i, f] as const))('fixture %i is a valid AgentMessage', (_i, fixture) => {
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });
});
