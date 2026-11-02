import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import type { ExternalCase } from '../connectors/connector.js';
import type { Tx } from '../database/database.js';
import { Outbox } from '../events/outbox.js';
import type { AttachedDocument, Fields, RequestField, RequestStatus } from './requests.repository.js';

export interface InformationRequest {
  detail: string;
  at: string;
  by: string;
}

export interface RelayedDocument {
  sourceId: string;
  fileId: string;
  name: string;
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg';
  createdAt: string;
  expiresAt: string;
}

export interface WorkflowRow {
  id: string;
  conversation_id: string;
  user_ref: string;
  procedure_id: string;
  status: RequestStatus;
  fields: Fields | RequestField[];
  documents: AttachedDocument[];
  official_link: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  administration_id: string | null;
  title: string | null;
  processing_days: number | null;
  revision: number;
  receipt: { reference: string; receivedAt: string } | null;
  submitted_at: Date | string | null;
  due_at: Date | string | null;
  external_state: ExternalCase | null;
  assigned_to: string | null;
  information_request: InformationRequest | null;
  issued_documents: RelayedDocument[];
  connector: string | null;
  external_ref: string | null;
  submission_state: string | null;
  mandate_id: string | null;
}

export interface Blocking {
  code: string;
  detail: string;
  at: string;
}

export type DepartmentRequest = Record<string, unknown> & { id: string; revision: number; status: RequestStatus; administrationId: string };

const COLUMNS = `id, conversation_id, user_ref, procedure_id, status, fields, documents, official_link, created_at, updated_at, administration_id, title,
  processing_days, revision, receipt, submitted_at, due_at, external_state, assigned_to, information_request, issued_documents, connector,
  external_ref, submission_state, mandate_id`;

const PROGRESS: Record<RequestStatus, { step: number; label: string }> = {
  draft: { step: 1, label: 'Informations en cours de collecte' },
  ready: { step: 2, label: 'Dossier prêt, en attente de dépôt' },
  submitted: { step: 3, label: 'Dossier déposé auprès de l’administration' },
  cancelled: { step: 3, label: 'Demande annulée' },
};
const PROGRESS_TOTAL = 3;
const FILED: ReadonlySet<RequestStatus> = new Set(['submitted']);
const iso = (value: Date | string) => new Date(value).toISOString();

export function deriveStatus(row: Pick<WorkflowRow, 'external_state' | 'assigned_to' | 'information_request' | 'status' | 'updated_at'>): {
  status: RequestStatus;
  blocking?: Blocking;
} {
  if (row.status === 'cancelled') return { status: 'cancelled' };
  if (row.external_state || row.status === 'submitted') return { status: 'submitted' };
  return { status: row.status };
}

@Injectable()
export class RequestWorkflow {
  private readonly logger = new Logger(RequestWorkflow.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly outbox: Outbox,
  ) {}

  get snapshots(): boolean {
    return this.config.snapshots;
  }

  async load(tx: Tx, id: string, lock = false): Promise<WorkflowRow> {
    const [row] = await tx.query<WorkflowRow>(`select ${COLUMNS} from requests where id = $1${lock ? ' for update' : ''}`, [id]);
    if (!row) throw new ProblemError(404, 'NOT_FOUND', 'Demande inconnue');
    return row;
  }

  async restate(tx: Tx, id: string, traceId: string, action: string, actorRef?: string): Promise<{ from: RequestStatus; to: RequestStatus; snapshot?: DepartmentRequest }> {
    const row = await this.load(tx, id, true);
    const { status } = deriveStatus(row);
    if (status !== row.status) await tx.query('update requests set status = $2, updated_at = now() where id = $1', [id, status]);
    if (this.snapshots) return { from: row.status, to: status, snapshot: await this.publish(tx, id, traceId, action, actorRef) };
    return { from: row.status, to: status };
  }

  async publish(tx: Tx, id: string, traceId: string, action: string, actorRef?: string): Promise<DepartmentRequest | undefined> {
    if (!this.snapshots) return undefined;
    const [row] = await tx.query<WorkflowRow>(`update requests set revision = revision + 1 where id = $1 returning ${COLUMNS}`, [id]);
    if (!row) throw new ProblemError(404, 'NOT_FOUND', 'Demande inconnue');
    if (!row.administration_id || !row.title) {
      this.logger.warn(`Demande ${id} sans administration : pas de snapshot`);
      return undefined;
    }
    return this.snapshotOf(row);
  }

  snapshotOf(row: WorkflowRow): DepartmentRequest {
    const { status, blocking } = deriveStatus(row);
    const external = row.external_state;
    const filed = FILED.has(status) && row.receipt !== null && row.submitted_at !== null;
    const progress = PROGRESS[status];
    const confirmed = !['draft', 'ready'].includes(status);
    return {
      id: row.id,
      conversationId: row.conversation_id,
      userRef: row.user_ref,
      procedureId: row.procedure_id,
      administrationId: row.administration_id as string,
      title: row.title as string,
      status,
      revision: row.revision,
      fields: row.fields,
      fileIds: [...new Set(row.documents.map((document) => document.fileId).filter((id): id is string => Boolean(id)))],
      officialLink: row.official_link,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      simulation: true,
      ...(filed ? { submittedAt: iso(row.submitted_at as Date | string), receiptRef: (row.receipt as { reference: string }).reference } : {}),
      ...(filed && row.due_at ? { dueAt: iso(row.due_at) } : {}),
      assignedTo: row.assigned_to,
      ...(external?.payment
        ? {
            payment: {
              status: external.payment.status,
              amountFcfa: external.payment.amountFcfa,
              currency: 'XOF',
              ...(external.payment.reference ? { reference: external.payment.reference } : {}),
            },
          }
        : {}),
      documents: row.issued_documents.map(({ fileId, name, mimeType, createdAt, expiresAt }) => ({ fileId, name, mimeType, createdAt, expiresAt, simulation: true })),
      progress: { step: progress.step, total: PROGRESS_TOTAL, label: progress.label },
      evidence: (Array.isArray(row.fields) ? row.fields.map((field) => field.name) : Object.keys(row.fields ?? {}))
        .filter((field) => field.length <= 100)
        .map((field) => ({ field, source: 'user', confirmed })),
    };
  }
}

@Global()
@Module({ providers: [RequestWorkflow], exports: [RequestWorkflow] })
export class RequestWorkflowModule {}
