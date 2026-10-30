import type { Procedure } from './c3-client';

export interface ProcedureDraft {
  title: string;
  summary: string;
  requiredDocuments: string[];
  feeFcfa: string;
  processingDays: string;
  sourceUrl: string;
  sourceVersion: string;
  /** `datetime-local` value (local time, minute precision). */
  retrievedAt: string;
  validationStatus: Procedure['validationStatus'];
  formSchemaText: string;
}

export type ProcedureErrors = Partial<Record<keyof ProcedureDraft, string>>;

type FormSchema = Procedure['formSchema'];

const pad = (value: number) => String(value).padStart(2, '0');

/** ISO date-time -> `datetime-local` value (local time); empty when unparsable. */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value (local time) -> ISO UTC string; null when invalid. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type ParsedFormSchema = { ok: true; value: FormSchema } | { ok: false; error: string };

export function parseFormSchema(text: string): ParsedFormSchema {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Le JSON est invalide.' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Le formulaire doit être un objet JSON.' };
  }
  return { ok: true, value: value as FormSchema };
}

export interface FormProperty {
  name: string;
  type: string;
  required: boolean;
}

/** Lists the `properties` of a JSON schema with their type and required flag. */
export function describeFormSchema(schema: FormSchema): FormProperty[] {
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(properties).map(([name, definition]) => {
    const type = (definition as { type?: unknown } | null)?.type;
    return {
      name,
      type: typeof type === 'string' ? type : Array.isArray(type) ? type.join(' | ') : '—',
      required: required.has(name),
    };
  });
}

export const toProcedureDraft = (procedure: Procedure): ProcedureDraft => ({
  title: procedure.title,
  summary: procedure.summary,
  requiredDocuments: [...procedure.requiredDocuments],
  feeFcfa: String(procedure.feeFcfa),
  processingDays: String(procedure.processingDays),
  sourceUrl: procedure.source.url,
  sourceVersion: procedure.source.version,
  retrievedAt: isoToLocalInput(procedure.source.retrievedAt),
  validationStatus: procedure.validationStatus,
  formSchemaText: JSON.stringify(procedure.formSchema, null, 2),
});

const isNonNegativeInteger = (value: string) => /^\d+$/.test(value.trim());

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateProcedure(draft: ProcedureDraft): ProcedureErrors {
  const errors: ProcedureErrors = {};
  if (!draft.title.trim()) errors.title = 'Le titre est obligatoire.';
  if (!draft.summary.trim()) errors.summary = 'Le résumé est obligatoire.';
  const documents = draft.requiredDocuments.map((item) => item.trim());
  if (documents.some((item) => !item) || new Set(documents).size !== documents.length) {
    errors.requiredDocuments = 'Les pièces requises ne peuvent être ni vides ni en double.';
  }
  if (!isNonNegativeInteger(draft.feeFcfa)) errors.feeFcfa = 'Les frais doivent être un entier positif ou nul.';
  if (!isNonNegativeInteger(draft.processingDays)) {
    errors.processingDays = 'Le délai doit être un entier positif ou nul.';
  }
  if (!isHttpUrl(draft.sourceUrl)) errors.sourceUrl = 'L’adresse doit être une URL http ou https valide.';
  if (!draft.sourceVersion.trim()) errors.sourceVersion = 'La version de la source est obligatoire.';
  if (localInputToIso(draft.retrievedAt) === null) errors.retrievedAt = 'La date de récupération est obligatoire.';
  const schema = parseFormSchema(draft.formSchemaText);
  if (!schema.ok) errors.formSchemaText = schema.error;
  return errors;
}

/** Full replacement: every field of the loaded procedure, with the edits applied. */
export function toProcedure(draft: ProcedureDraft, base: Procedure): Procedure {
  const schema = parseFormSchema(draft.formSchemaText);
  // An untouched date keeps the server value (seconds and milliseconds included).
  const retrievedAt =
    draft.retrievedAt === isoToLocalInput(base.source.retrievedAt)
      ? base.source.retrievedAt
      : (localInputToIso(draft.retrievedAt) ?? base.source.retrievedAt);
  return {
    ...base,
    title: draft.title,
    summary: draft.summary,
    requiredDocuments: draft.requiredDocuments,
    feeFcfa: Number(draft.feeFcfa),
    processingDays: Number(draft.processingDays),
    source: { ...base.source, url: draft.sourceUrl, version: draft.sourceVersion, retrievedAt },
    validationStatus: draft.validationStatus,
    formSchema: schema.ok ? schema.value : base.formSchema,
  };
}
