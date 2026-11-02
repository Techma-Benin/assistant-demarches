import { Injectable } from '@nestjs/common';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';
import type { Procedure } from '../resources/backend-resources.client.js';

const addFormats = addFormatsPlugin as unknown as (ajv: Ajv2020) => Ajv2020;

const FORBIDDEN_FIELD = /^(npi|nip|otp|pin|password|mot_?de_?passe|code_?sms|ifu)$/i;
const MAX_CACHE = 200;

export interface FormCheck {
  partial: ValidateFunction;
  complete: ValidateFunction;
}

@Injectable()
export class FormSchemas {
  private readonly ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
  private readonly cache = new Map<string, FormCheck>();

  for(procedure: Procedure): FormCheck {
    const key = `${procedure.id}@${procedure.source.version}`;
    let check = this.cache.get(key);
    if (!check) {
      const filing = procedure.filing as { formSchema?: Record<string, unknown> } | null | undefined;
      const formSchema = filing?.formSchema ?? procedure.formSchema ?? { type: 'object', properties: {}, required: [] };
      const schema = { ...formSchema, additionalProperties: false };
      check = { partial: this.ajv.compile({ ...schema, required: [] }), complete: this.ajv.compile(schema) };
      if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, check);
    }
    return check;
  }

  forbiddenField(fields: Record<string, unknown>): string | undefined {
    return Object.keys(fields).find((name) => FORBIDDEN_FIELD.test(name.replace(/[-\s]/g, '_')));
  }
}
