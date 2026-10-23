import { Injectable } from '@nestjs/common';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';
import type { Procedure } from '../resources/backend-resources.client.js';

const addFormats = addFormatsPlugin as unknown as (ajv: Ajv2020) => Ajv2020;

// Identifiants et secrets d'État : jamais dans les champs v1, même si une fiche les déclarait.
const FORBIDDEN_FIELD = /^(npi|nip|otp|pin|password|mot_?de_?passe|code_?sms|ifu)$/i;
const MAX_CACHE = 200;

export interface FormCheck {
  /** Champs connus et bien typés, obligatoires non exigés (brouillon). */
  partial: ValidateFunction;
  /** Formulaire complet. */
  complete: ValidateFunction;
}

/**
 * Validateurs compilés depuis Procedure.formSchema (JSON Schema 2020-12), mis en cache
 * par fiche et version. Les schémas viennent du Backend, service de confiance authentifié.
 */
@Injectable()
export class FormSchemas {
  private readonly ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
  private readonly cache = new Map<string, FormCheck>();

  for(procedure: Procedure): FormCheck {
    const key = `${procedure.id}@${procedure.source.version}`;
    let check = this.cache.get(key);
    if (!check) {
      const schema = { ...procedure.formSchema, additionalProperties: false };
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
