import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { ServiceTokens } from '../auth/service-tokens.js';
import { ProblemError } from '../common/problem.js';
import { childTraceparent, type TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { domainValidator, errorsText } from '../contracts.js';
import type { Procedure } from '../resources/backend-resources.client.js';

export type CaseStatus = 'awaiting_payment' | 'received' | 'in_review' | 'completed' | 'rejected';

/** The fields of a C5 case the Tooling relies on; the full shape is checked against the contract. */
export interface XroadCase {
  id: string;
  reference: string;
  simulated: true;
  administrationId: string;
  requestId: string;
  status: CaseStatus;
  payment: { amountFcfa: number; status: 'not_required' | 'pending' | 'paid'; method: 'mobile_money' | null; reference: string | null; paidAt: string | null };
  steps: { id: string; label: string; state: 'done' | 'blocked' | 'pending'; actor: 'assistant' | 'applicant' | 'administration'; note: string | null; at: string | null }[];
  issuedDocuments: { id: string; title: string; mimeType: 'application/pdf' | 'image/png' | 'image/jpeg'; issuedAt: string }[];
  completedBy: 'assistant' | 'administration' | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseDecision {
  decision: 'approve' | 'reject';
  note: string | null;
  actorRef: string;
  idempotencyKey: string;
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface CaseInput {
  requestId: string;
  procedureId: string;
  fields: Record<string, string | number | boolean | null>;
  documents: { documentType: string; fileId: string; mimeType: string; sizeBytes: number }[];
}

interface Call {
  method: 'GET' | 'POST';
  path: string;
  trace: Pick<TraceContext, 'traceId'>;
  applicantRef?: string;
  actorRef?: string;
  body?: unknown;
  idempotencyKey?: string;
  notFound?: string;
  binary?: boolean;
}

const procedurePage = domainValidator('ProcedurePage');
const procedure = domainValidator('Procedure');
const caseSchema = domainValidator('Case');

/** Client of the simulated X-Road (contract C5), under the `tooling-xroad` identity, always for one applicant. */
@Injectable()
export class XroadClient {
  private readonly logger = new Logger(XroadClient.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly tokens: ServiceTokens,
  ) {}

  async searchProcedures(query: string, trace: TraceContext): Promise<Procedure[]> {
    const page = await this.call({ method: 'GET', path: `v1/procedures?${new URLSearchParams({ query, limit: '100' })}`, trace });
    if (!procedurePage(page)) throw this.nonConforming(`liste de fiches (${errorsText(procedurePage)})`);
    return (page as { items: Procedure[] }).items;
  }

  async getProcedure(procedureId: string, trace: TraceContext): Promise<Procedure> {
    const found = await this.call({ method: 'GET', path: `v1/procedures/${encodeURIComponent(procedureId)}`, trace, notFound: 'Fiche inconnue' });
    if (!procedure(found)) throw this.nonConforming(`fiche (${errorsText(procedure)})`);
    if ((found as Procedure).id !== procedureId) throw this.nonConforming('fiche demandée');
    return found as Procedure;
  }

  async createCase(applicantRef: string, input: CaseInput, trace: Pick<TraceContext, 'traceId'>): Promise<XroadCase> {
    // One key per request: a retry after a lost response files the same case, never a second one.
    const created = await this.call({ method: 'POST', path: 'v1/cases', trace, applicantRef, body: input, idempotencyKey: `submit-${input.requestId}` });
    return this.checkCase(created, input.requestId);
  }

  async getCase(applicantRef: string, caseId: string, requestId: string, trace: Pick<TraceContext, 'traceId'>): Promise<XroadCase> {
    const found = await this.call({ method: 'GET', path: `v1/cases/${encodeURIComponent(caseId)}`, trace, applicantRef, notFound: 'Dossier inconnu' });
    return this.checkCase(found, requestId);
  }

  async pay(applicantRef: string, caseId: string, requestId: string, trace: Pick<TraceContext, 'traceId'>): Promise<XroadCase> {
    const paid = await this.call({
      method: 'POST',
      path: `v1/cases/${encodeURIComponent(caseId)}/payment`,
      trace,
      applicantRef,
      body: { method: 'mobile_money' },
      idempotencyKey: `pay-${requestId}`,
      notFound: 'Dossier inconnu',
    });
    return this.checkCase(paid, requestId);
  }

  async decide(caseId: string, requestId: string, input: CaseDecision, trace: Pick<TraceContext, 'traceId'>): Promise<XroadCase> {
    const decided = await this.call({
      method: 'POST',
      path: `v1/cases/${encodeURIComponent(caseId)}/decisions`,
      trace,
      actorRef: input.actorRef,
      body: { decision: input.decision, note: input.note },
      idempotencyKey: input.idempotencyKey,
      notFound: 'Dossier inconnu',
    });
    return this.checkCase(decided, requestId);
  }

  async issuedDocument(applicantRef: string, caseId: string, documentId: string, trace: Pick<TraceContext, 'traceId'>): Promise<Buffer> {
    const bytes = await this.call({
      method: 'GET',
      path: `v1/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}`,
      trace,
      applicantRef,
      notFound: 'Document inconnu',
      binary: true,
    });
    return bytes as Buffer;
  }

  private checkCase(value: unknown, requestId: string): XroadCase {
    if (!caseSchema(value)) throw this.nonConforming(`dossier (${errorsText(caseSchema)})`);
    if ((value as XroadCase).requestId !== requestId) throw this.nonConforming('dossier d’une autre demande');
    return value as XroadCase;
  }

  private async call({ method, path, trace, applicantRef, actorRef, body, idempotencyKey, notFound = 'Ressource inconnue', binary = false }: Call): Promise<unknown> {
    if (!this.config.xroadUrl) throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'X-Road non configuré');
    const url = new URL(path, this.config.xroadUrl.href.replace(/\/?$/, '/'));
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.tokens.get('tooling-xroad')}`,
          traceparent: childTraceparent(trace),
          Accept: binary ? 'application/pdf, image/png, image/jpeg' : 'application/json',
          ...(applicantRef ? { 'X-Applicant-Ref': applicantRef } : {}),
          ...(actorRef ? { 'X-Actor-Ref': actorRef } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      this.logger.error(`X-Road injoignable : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'X-Road indisponible');
    }
    if (res.status === 404) throw new ProblemError(404, 'NOT_FOUND', notFound);
    if (res.status === 401 || res.status === 403) {
      this.tokens.invalidate('tooling-xroad');
      this.logger.error(`X-Road refuse l'identité tooling-xroad : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'X-Road indisponible');
    }
    if (res.status === 409) {
      // Business refusals (incomplete case, nothing to pay…) are relayed: retrying would not change them.
      const problem = (await res.json().catch(() => undefined)) as { code?: string; detail?: string } | undefined;
      const code = problem?.code === 'REQUEST_INCOMPLETE' ? 'REQUEST_INCOMPLETE' : 'INVALID_TRANSITION';
      throw new ProblemError(409, code, problem?.detail ?? 'Refus du X-Road');
    }
    if (res.status === 400) {
      const problem = (await res.json().catch(() => undefined)) as { detail?: string } | undefined;
      this.logger.error(`X-Road refuse la requête : ${problem?.detail ?? 'HTTP 400'}`);
      throw new ProblemError(409, 'INVALID_TRANSITION', 'Dossier refusé par le X-Road : requête invalide');
    }
    if (!res.ok) {
      this.logger.error(`X-Road en erreur : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'X-Road indisponible');
    }
    if (binary) {
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) throw this.nonConforming('document trop volumineux');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_DOCUMENT_BYTES || bytes.length === 0) throw this.nonConforming('document');
      return bytes;
    }
    try {
      return await res.json();
    } catch {
      throw this.nonConforming('JSON');
    }
  }

  private nonConforming(what: string): ProblemError {
    this.logger.error(`Réponse X-Road non conforme : ${what}`);
    return new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Réponse amont non conforme');
  }
}

@Global()
@Module({ providers: [XroadClient], exports: [XroadClient] })
export class XroadModule {}
