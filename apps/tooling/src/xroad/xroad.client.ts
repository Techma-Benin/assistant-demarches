import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { ServiceTokens } from '../auth/service-tokens.js';
import { ProblemError, type ProblemCode } from '../common/problem.js';
import { childTraceparent, type TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { domainValidator, errorsText } from '../contracts.js';

export type FieldValue = string | number | boolean | null;

export interface RequiredDocument {
  documentType: string;
  label: string;
  acceptedMimeTypes: string[];
}

export interface Filing {
  scope: string;
  formSchema: { properties?: Record<string, { title?: string; description?: string }>; required?: string[] } & Record<string, unknown>;
  requiredDocuments: RequiredDocument[];
  feeFcfa: number;
  processingDays: number | null;
}

export interface Procedure {
  id: string;
  title: string;
  administrationId: string;
  filing: Filing | null;
  [field: string]: unknown;
}

export type CaseStatus = 'awaiting_payment' | 'received' | 'in_review' | 'information_requested' | 'completed' | 'rejected';

export interface XroadCase {
  id: string;
  requestId: string;
  status: CaseStatus;
  updatedAt: string;
  payment: { status: 'not_required' | 'pending' | 'paid' };
  [field: string]: unknown;
}

export interface DocumentRef {
  documentType: string;
  uploadId: string;
}

interface Call {
  method: 'GET' | 'POST';
  path: string;
  trace: Pick<TraceContext, 'traceId'>;
  applicantRef?: string;
  body?: unknown;
  binary?: { bytes: Buffer; mimeType: string };
  idempotencyKey?: string;
  notFound?: string;
}

const procedurePage = domainValidator('ProcedurePage');
const procedureSchema = domainValidator('Procedure');
const caseSchema = domainValidator('Case');
const uploadSchema = domainValidator('Upload');
const RELAYED: ReadonlySet<ProblemCode> = new Set(['NOT_ASSISTED', 'REQUEST_INCOMPLETE', 'INVALID_TRANSITION', 'CONFLICT']);

@Injectable()
export class XroadClient {
  private readonly logger = new Logger(XroadClient.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly tokens: ServiceTokens,
  ) {}

  async searchProcedures(query: string, trace: Pick<TraceContext, 'traceId'>): Promise<Procedure[]> {
    const page = await this.call({ method: 'GET', path: `v1/procedures?${new URLSearchParams({ query, limit: '20' })}`, trace });
    if (!procedurePage(page)) throw this.nonConforming(`liste de fiches (${errorsText(procedurePage)})`);
    return (page as { items: Procedure[] }).items;
  }

  async getProcedure(procedureId: string, trace: Pick<TraceContext, 'traceId'>): Promise<Procedure> {
    const found = await this.call({ method: 'GET', path: `v1/procedures/${encodeURIComponent(procedureId)}`, trace, notFound: 'Démarche inconnue' });
    if (!procedureSchema(found)) throw this.nonConforming(`fiche (${errorsText(procedureSchema)})`);
    if ((found as Procedure).id !== procedureId) throw this.nonConforming('fiche demandée');
    return found as Procedure;
  }

  async upload(applicantRef: string, bytes: Buffer, mimeType: string, trace: Pick<TraceContext, 'traceId'>): Promise<{ id: string }> {
    const uploaded = await this.call({ method: 'POST', path: 'v1/uploads', trace, applicantRef, binary: { bytes, mimeType } });
    if (!uploadSchema(uploaded)) throw this.nonConforming(`pièce transmise (${errorsText(uploadSchema)})`);
    return uploaded as { id: string };
  }

  async createCase(
    applicantRef: string,
    input: { requestId: string; procedureId: string; channel: 'web' | 'whatsapp'; fields: Record<string, FieldValue>; documents: DocumentRef[] },
    trace: Pick<TraceContext, 'traceId'>,
  ): Promise<XroadCase> {
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

  async respond(
    applicantRef: string,
    caseId: string,
    requestId: string,
    input: { message: string; fields: Record<string, FieldValue>; documents: DocumentRef[] },
    idempotencyKey: string,
    trace: Pick<TraceContext, 'traceId'>,
  ): Promise<XroadCase> {
    const answered = await this.call({
      method: 'POST',
      path: `v1/cases/${encodeURIComponent(caseId)}/responses`,
      trace,
      applicantRef,
      body: input,
      idempotencyKey,
      notFound: 'Dossier inconnu',
    });
    return this.checkCase(answered, requestId);
  }

  private checkCase(value: unknown, requestId: string): XroadCase {
    if (!caseSchema(value)) throw this.nonConforming(`dossier (${errorsText(caseSchema)})`);
    if ((value as XroadCase).requestId !== requestId) throw this.nonConforming('dossier d’une autre demande');
    return value as XroadCase;
  }

  private async call({ method, path, trace, applicantRef, body, binary, idempotencyKey, notFound = 'Ressource inconnue' }: Call): Promise<unknown> {
    const url = new URL(path, this.config.xroadUrl.href.replace(/\/?$/, '/'));
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.tokens.get()}`,
          traceparent: childTraceparent(trace),
          Accept: 'application/json',
          ...(applicantRef ? { 'X-Applicant-Ref': applicantRef } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(binary ? { 'Content-Type': 'application/octet-stream', 'X-File-Mime-Type': binary.mimeType } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: binary ? new Uint8Array(binary.bytes) : body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      this.logger.error(`X-Road injoignable : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'X-Road indisponible');
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw this.nonConforming('JSON');
      }
    }
    const problem = (await res.json().catch(() => undefined)) as { code?: string; detail?: string } | undefined;
    if (res.status === 404) throw new ProblemError(404, 'NOT_FOUND', notFound);
    if (res.status === 401 || res.status === 403) {
      this.tokens.invalidate();
      this.logger.error(`X-Road refuse l'identité tooling : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'X-Road indisponible');
    }
    if (res.status === 409 && problem?.code && RELAYED.has(problem.code as ProblemCode)) {
      throw new ProblemError(409, problem.code as ProblemCode, problem.detail ?? 'Refus du X-Road');
    }
    if (res.status === 400 || res.status === 409 || res.status === 413 || res.status === 415) {
      this.logger.error(`X-Road refuse la requête : ${problem?.detail ?? `HTTP ${res.status}`}`);
      throw new ProblemError(409, 'INVALID_TRANSITION', problem?.detail ?? 'Requête refusée par le X-Road');
    }
    this.logger.error(`X-Road en erreur : HTTP ${res.status}`);
    throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'X-Road indisponible');
  }

  private nonConforming(what: string): ProblemError {
    this.logger.error(`Réponse X-Road non conforme : ${what}`);
    return new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Réponse amont non conforme');
  }
}

@Global()
@Module({ providers: [XroadClient], exports: [XroadClient] })
export class XroadModule {}
