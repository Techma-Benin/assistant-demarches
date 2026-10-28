import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ContractEvent } from '../contracts/types.js';

// ajv et ajv-formats sont des modules CommonJS : l’export par défaut dépend de l’interopérabilité.
const interop = <T>(mod: unknown): T => ((mod as { default?: T }).default ?? mod) as T;
const Ajv2020 = interop<typeof Ajv2020Module.default>(Ajv2020Module);
const addFormats = interop<typeof addFormatsModule.default>(addFormatsModule);

export type EventValidation = { ok: true; event: ContractEvent } | { ok: false; detail: string };

export interface EventValidator {
  validate(body: unknown): EventValidation;
}

/** Valide un `Event` C4 contre contracts/v1/domain.schema.json, plus `type === bj.techma.{kind}.v1`. */
export class AjvEventValidator implements EventValidator {
  private readonly check;

  constructor(contractsDir: string) {
    const domain = JSON.parse(readFileSync(join(contractsDir, 'domain.schema.json'), 'utf8')) as { $id: string };
    const ajv = new Ajv2020({ allErrors: false, strict: false });
    addFormats(ajv);
    ajv.addSchema(domain);
    const check = ajv.getSchema(`${domain.$id}#/$defs/Event`);
    if (!check) throw new Error('Schéma Event introuvable dans les contrats');
    this.check = check;
  }

  validate(body: unknown): EventValidation {
    if (!this.check(body)) {
      const first = this.check.errors?.[0];
      return { ok: false, detail: `Événement invalide : ${first?.instancePath || '/'} ${first?.message ?? ''}`.trim() };
    }
    const event = body as ContractEvent;
    if (event.type !== `bj.techma.${event.data.kind}.v1`) {
      return { ok: false, detail: 'Événement invalide : type incompatible avec data.kind' };
    }
    return { ok: true, event };
  }
}
