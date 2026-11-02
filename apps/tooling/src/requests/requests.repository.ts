import { Injectable } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import type { Tx } from '../database/database.js';

export type RequestStatus = 'draft' | 'ready' | 'awaiting_user_validation' | 'submitted' | 'processing' | 'completed' | 'rejected' | 'cancelled' | 'blocked';
export type Fields = Record<string, string | number | boolean | null>;
export interface AttachedDocument {
  documentType: string;
  fileId: string;
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
  status: RequestStatus;
  fields: Fields;
  documents: AttachedDocument[];
  officialLink: string | null;
  updatedAt: string;
}

interface RequestRow {
  id: string;
  conversation_id: string;
  user_ref: string;
  procedure_id: string;
  status: RequestStatus;
  fields: Fields;
  documents: AttachedDocument[];
  official_link: string | null;
  updated_at: Date | string;
}

const COLUMNS = 'id, conversation_id, user_ref, procedure_id, status, fields, documents, official_link, updated_at';

const fromRow = (row: RequestRow): RequestRecord => ({
  id: row.id,
  conversationId: row.conversation_id,
  userRef: row.user_ref,
  procedureId: row.procedure_id,
  status: row.status,
  fields: row.fields,
  documents: row.documents,
  officialLink: row.official_link,
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const toContract = (request: RequestRecord) => ({
  id: request.id,
  conversationId: request.conversationId,
  userRef: request.userRef,
  procedureId: request.procedureId,
  status: request.status,
  fields: request.fields,
  fileIds: [...new Set(request.documents.map((document) => document.fileId))],
  officialLink: request.officialLink,
  updatedAt: request.updatedAt,
});

@Injectable()
export class RequestsRepository {
  async insert(tx: Tx, request: Omit<RequestRecord, 'updatedAt'>, route: RequestRoute): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(
      `insert into requests (id, conversation_id, user_ref, procedure_id, status, fields, documents, official_link, administration_id, title, processing_days)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11) returning ${COLUMNS}`,
      [
        request.id,
        request.conversationId,
        request.userRef,
        request.procedureId,
        request.status,
        JSON.stringify(request.fields),
        JSON.stringify(request.documents),
        request.officialLink,
        route.administrationId,
        route.title,
        route.processingDays,
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

  async update(tx: Tx, request: RequestRecord): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(
      `update requests set status = $2, fields = $3::jsonb, documents = $4::jsonb, official_link = $5, updated_at = now()
       where id = $1 returning ${COLUMNS}`,
      [request.id, request.status, JSON.stringify(request.fields), JSON.stringify(request.documents), request.officialLink],
    );
    return fromRow(row);
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
