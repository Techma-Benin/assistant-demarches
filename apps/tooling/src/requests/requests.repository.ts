import { Injectable } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import type { Tx } from '../database/database.js';

export type RequestStatus = 'draft' | 'ready' | 'submitted' | 'cancelled';
export type FieldValue = string | number | boolean | null;
export type Fields = Record<string, FieldValue>;
export type RequestField = { name: string; label: string; value: FieldValue; source: 'answer' | 'document' | null };
export interface AttachedDocument {
  documentType: string;
  label: string;
  fileId: string | null;
}

export interface RequestRoute {
  administrationId: string;
  title: string;
  processingDays: number | null;
}

export interface RequestRecord {
  id: string;
  conversationId: string;
  userRef: string;
  procedureId: string;
  title: string;
  administrationId: string;
  status: RequestStatus;
  fields: RequestField[];
  documents: AttachedDocument[];
  missing: string[];
  caseId: string | null;
  updatedAt: string;
}

interface RequestRow {
  id: string;
  conversation_id: string;
  user_ref: string;
  procedure_id: string;
  title: string | null;
  administration_id: string | null;
  status: RequestStatus;
  fields: RequestField[] | Record<string, FieldValue>;
  documents: AttachedDocument[] | { documentType: string; fileId: string }[];
  case_id: string | null;
  updated_at: Date | string;
}

const COLUMNS = 'id, conversation_id, user_ref, procedure_id, title, administration_id, status, fields, documents, case_id, updated_at';

function asFields(value: RequestRow['fields']): RequestField[] {
  if (Array.isArray(value)) return value;
  return Object.entries(value ?? {}).map(([name, fieldValue]) => ({
    name,
    label: name,
    value: fieldValue,
    source: 'answer' as const,
  }));
}

function asDocuments(value: RequestRow['documents']): AttachedDocument[] {
  return (value ?? []).map((document) => ({
    documentType: document.documentType,
    label: 'label' in document && typeof document.label === 'string' ? document.label : document.documentType,
    fileId: document.fileId ?? null,
  }));
}

const fromRow = (row: RequestRow, missing: string[] = []): RequestRecord => ({
  id: row.id,
  conversationId: row.conversation_id,
  userRef: row.user_ref,
  procedureId: row.procedure_id,
  title: row.title ?? row.procedure_id,
  administrationId: row.administration_id ?? 'unknown',
  status: row.status,
  fields: asFields(row.fields),
  documents: asDocuments(row.documents),
  missing,
  caseId: row.case_id,
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const toContract = (request: RequestRecord) => ({
  id: request.id,
  conversationId: request.conversationId,
  procedureId: request.procedureId,
  title: request.title,
  administrationId: request.administrationId,
  status: request.status,
  fields: request.fields,
  documents: request.documents,
  missing: request.missing,
  caseId: request.caseId,
  updatedAt: request.updatedAt,
});

@Injectable()
export class RequestsRepository {
  async insert(tx: Tx, request: Omit<RequestRecord, 'updatedAt' | 'missing' | 'title' | 'administrationId' | 'caseId'> & { missing?: string[] }, route: RequestRoute): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(
      `insert into requests (id, conversation_id, user_ref, procedure_id, status, fields, documents, official_link, administration_id, title, processing_days, case_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12) returning ${COLUMNS}`,
      [
        request.id,
        request.conversationId,
        request.userRef,
        request.procedureId,
        request.status,
        JSON.stringify(request.fields),
        JSON.stringify(request.documents),
        null,
        route.administrationId,
        route.title,
        route.processingDays,
        null,
      ],
    );
    return fromRow(row, request.missing ?? []);
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

  async update(tx: Tx, request: RequestRecord): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(
      `update requests set status = $2, fields = $3::jsonb, documents = $4::jsonb, case_id = $5, updated_at = now()
       where id = $1 returning ${COLUMNS}`,
      [request.id, request.status, JSON.stringify(request.fields), JSON.stringify(request.documents), request.caseId],
    );
    return fromRow(row, request.missing);
  }

  async submission(tx: Tx, id: string): Promise<{ connector: string | null; externalRef: string | null; state: string | null }> {
    const [row] = await tx.query<{ connector: string | null; external_ref: string | null; submission_state: string | null }>(
      'select connector, external_ref, submission_state from requests where id = $1',
      [id],
    );
    if (!row) throw new ProblemError(404, 'NOT_FOUND', 'Demande inconnue');
    return { connector: row.connector, externalRef: row.external_ref, state: row.submission_state };
  }

  async recordExternal(tx: Tx, id: string, state: unknown): Promise<void> {
    await tx.query(
      "update requests set external_state = $2::jsonb, updated_at = now(), next_check_at = case when submission_state = 'sent' then now() else next_check_at end where id = $1",
      [id, JSON.stringify(state)],
    );
  }

  async queueSubmission(tx: Tx, id: string, connector: string, mandateId: string): Promise<void> {
    await tx.query(
      `update requests set connector = $2, mandate_id = $3, submission_state = 'queued', queued_at = now(), next_check_at = now(), connector_attempts = 0, connector_error = null
       where id = $1`,
      [id, connector, mandateId],
    );
  }
}
