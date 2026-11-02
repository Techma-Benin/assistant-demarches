import { Injectable } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import { compileSchema } from '../contracts.js';
import type { Tx } from '../database/database.js';
import type { FieldValue, Filing, Procedure } from '../xroad/xroad.client.js';

export type RequestStatus = 'draft' | 'ready' | 'submitted' | 'cancelled';

export interface RequestField {
  name: string;
  label: string;
  value: FieldValue;
  source: 'answer' | 'document' | null;
}

export interface RequestDocument {
  documentType: string;
  label: string;
  fileId: string | null;
}

export interface RequestRecord {
  id: string;
  conversationId: string;
  userRef: string;
  procedureId: string;
  title: string;
  administrationId: string;
  status: RequestStatus;
  filing: Filing;
  fields: RequestField[];
  documents: RequestDocument[];
  caseId: string | null;
  updatedAt: string;
}

interface RequestRow {
  id: string;
  conversation_id: string;
  user_ref: string;
  procedure_id: string;
  title: string;
  administration_id: string;
  status: RequestStatus;
  filing: Filing;
  fields: RequestField[];
  documents: RequestDocument[];
  case_id: string | null;
  updated_at: Date | string;
}

const COLUMNS = 'id, conversation_id, user_ref, procedure_id, title, administration_id, status, filing, fields, documents, case_id, updated_at';
const label = (text: string) => text.slice(0, 200);

const fromRow = (row: RequestRow): RequestRecord => ({
  id: row.id,
  conversationId: row.conversation_id,
  userRef: row.user_ref,
  procedureId: row.procedure_id,
  title: row.title,
  administrationId: row.administration_id,
  status: row.status,
  filing: row.filing,
  fields: row.fields,
  documents: row.documents,
  caseId: row.case_id,
  updatedAt: new Date(row.updated_at).toISOString(),
});

export function fieldValues(request: Pick<RequestRecord, 'fields'>): Record<string, FieldValue> {
  return Object.fromEntries(request.fields.filter((field) => field.value !== null && field.value !== '').map((field) => [field.name, field.value]));
}

export function missingOf(request: Pick<RequestRecord, 'filing' | 'fields' | 'documents'>): string[] {
  const required = new Set(request.filing.formSchema.required ?? []);
  const values = fieldValues(request);
  return [
    ...request.fields.filter((field) => required.has(field.name) && !(field.name in values)).map((field) => field.label),
    ...request.documents.filter((document) => document.fileId === null).map((document) => document.label),
  ];
}

export function statusOf(request: Pick<RequestRecord, 'filing' | 'fields' | 'documents'>): 'draft' | 'ready' {
  if (missingOf(request).length) return 'draft';
  return compileSchema(request.filing.formSchema)(fieldValues(request)) ? 'ready' : 'draft';
}

export const toContract = (request: RequestRecord) => ({
  id: request.id,
  conversationId: request.conversationId,
  procedureId: request.procedureId,
  title: request.title,
  administrationId: request.administrationId,
  status: request.status,
  fields: request.fields,
  documents: request.documents,
  missing: request.status === 'submitted' || request.status === 'cancelled' ? [] : missingOf(request),
  caseId: request.caseId,
  updatedAt: request.updatedAt,
});

export function draftOf(procedure: Procedure & { filing: Filing }): Pick<RequestRecord, 'filing' | 'fields' | 'documents'> {
  const properties = procedure.filing.formSchema.properties ?? {};
  return {
    filing: procedure.filing,
    fields: Object.entries(properties).map(([name, schema]) => ({ name, label: label(schema.title ?? schema.description ?? name), value: null, source: null })),
    documents: procedure.filing.requiredDocuments.map((document) => ({ documentType: document.documentType, label: label(document.label), fileId: null })),
  };
}

@Injectable()
export class RequestsRepository {
  async insert(tx: Tx, request: Omit<RequestRecord, 'updatedAt' | 'caseId'>): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(
      `insert into requests (id, conversation_id, user_ref, procedure_id, title, administration_id, status, filing, fields, documents)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb) returning ${COLUMNS}`,
      [
        request.id,
        request.conversationId,
        request.userRef,
        request.procedureId,
        request.title,
        request.administrationId,
        request.status,
        JSON.stringify(request.filing),
        JSON.stringify(request.fields),
        JSON.stringify(request.documents),
      ],
    );
    return fromRow(row);
  }

  async findOwned(tx: Tx, id: string, owner: { userRef: string; conversationId: string }, lock = false): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(`select ${COLUMNS} from requests where id = $1 and user_ref = $2 and conversation_id = $3${lock ? ' for update' : ''}`, [
      id,
      owner.userRef,
      owner.conversationId,
    ]);
    if (!row) throw new ProblemError(404, 'NOT_FOUND', 'Demande inconnue');
    return fromRow(row);
  }

  async saveDraft(tx: Tx, request: RequestRecord): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(
      `update requests set status = $2, fields = $3::jsonb, documents = $4::jsonb, updated_at = now() where id = $1 returning ${COLUMNS}`,
      [request.id, request.status, JSON.stringify(request.fields), JSON.stringify(request.documents)],
    );
    return fromRow(row);
  }

  async markSubmitted(tx: Tx, id: string, caseId: string, channel: string, caseState: string): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(
      `update requests set status = 'submitted', case_id = $2, channel = $3, case_state = $4, next_check_at = now(), check_attempts = 0, updated_at = now()
       where id = $1 returning ${COLUMNS}`,
      [id, caseId, channel, caseState],
    );
    return fromRow(row);
  }

  async recordCaseState(tx: Tx, id: string, caseState: string): Promise<void> {
    await tx.query('update requests set case_state = $2, next_check_at = now() where id = $1', [id, caseState]);
  }
}
