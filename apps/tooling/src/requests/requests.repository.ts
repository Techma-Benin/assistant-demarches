import { Injectable } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import type { Tx } from '../database/database.js';

export type RequestStatus = 'draft' | 'ready' | 'awaiting_user_validation' | 'submitted' | 'processing' | 'completed' | 'rejected' | 'cancelled';
export type Fields = Record<string, string | number | boolean | null>;
export interface AttachedDocument {
  documentType: string;
  fileId: string;
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
  async insert(tx: Tx, request: Omit<RequestRecord, 'updatedAt'>): Promise<RequestRecord> {
    const [row] = await tx.query<RequestRow>(
      `insert into requests (id, conversation_id, user_ref, procedure_id, status, fields, documents, official_link)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8) returning ${COLUMNS}`,
      [request.id, request.conversationId, request.userRef, request.procedureId, request.status, JSON.stringify(request.fields), JSON.stringify(request.documents), request.officialLink],
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
}
