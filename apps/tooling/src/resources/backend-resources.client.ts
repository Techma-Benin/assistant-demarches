import { Inject, Injectable, Logger } from '@nestjs/common';
import { ServiceTokens } from '../auth/service-tokens.js';
import { ProblemError } from '../common/problem.js';
import { childTraceparent, type TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { domainValidator, errorsText } from '../contracts.js';

export interface Procedure {
  id: string;
  validationStatus: 'draft' | 'validated';
  requiredDocuments: string[];
  formSchema: Record<string, unknown>;
  source: { url: string; version: string };
  [field: string]: unknown;
}

export interface FileMetadata {
  id: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
}

export interface StoredDocument {
  id: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
}

const procedureSchema = domainValidator('Procedure');
const fileSchema = domainValidator('File');
const fileAccessSchema = domainValidator('FileAccess');
const isProcedure = (value: unknown): value is Procedure => procedureSchema(value) === true;
const isFileAccess = (value: unknown): value is { file: FileMetadata; userRef: string } => fileAccessSchema(value) === true;

@Injectable()
export class BackendResourcesClient {
  private readonly logger = new Logger(BackendResourcesClient.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly tokens: ServiceTokens,
  ) {}

  async searchProcedures(query: string, trace: TraceContext): Promise<Procedure[]> {
    const page = await this.get(`internal/v1/procedures?${new URLSearchParams({ query })}`, trace);
    const items = (page as { items?: unknown }).items;
    if (!Array.isArray(items)) throw this.nonConforming('liste de fiches');
    return items.filter((item): item is Procedure => {
      if (isProcedure(item)) return true;
      this.logger.error(`Fiche non conforme écartée de la recherche : ${errorsText(procedureSchema)}`);
      return false;
    });
  }

  async getProcedure(procedureId: string, trace: TraceContext): Promise<Procedure> {
    const procedure = await this.get(`internal/v1/procedures/${encodeURIComponent(procedureId)}`, trace, 'Fiche inconnue');
    if (!isProcedure(procedure)) throw this.nonConforming(`fiche (${errorsText(procedureSchema)})`);
    if (procedure.id !== procedureId) throw this.nonConforming('fiche demandée');
    return procedure;
  }

  async getFile(fileId: string, userRef: string, trace: TraceContext): Promise<FileMetadata> {
    const access = await this.get(`internal/v1/files/${encodeURIComponent(fileId)}`, trace, 'Pièce inconnue', { 'X-User-Ref': userRef });
    if (!isFileAccess(access) || access.file.id !== fileId) throw this.nonConforming('FileAccess');
    if (access.userRef !== userRef) throw new ProblemError(404, 'NOT_FOUND', 'Pièce inconnue');
    return access.file;
  }

  async getFileContent(fileId: string, userRef: string, trace: TraceContext): Promise<Buffer> {
    const url = new URL(`internal/v1/files/${encodeURIComponent(fileId)}/content`, this.config.backendUrl.href.replace(/\/?$/, '/'));
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await this.tokens.get('tooling-resources')}`,
          traceparent: childTraceparent(trace),
          Accept: 'application/pdf, image/png, image/jpeg, application/octet-stream',
          'X-User-Ref': userRef,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      this.logger.error(`Backend injoignable pour le contenu d'une pièce : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    }
    if (res.status === 404) throw new ProblemError(404, 'NOT_FOUND', 'Pièce inconnue');
    if (res.status === 401 || res.status === 403) {
      this.tokens.invalidate('tooling-resources');
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    }
    if (!res.ok) throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    return Buffer.from(await res.arrayBuffer());
  }

  async storeIssuedDocument(
    requestId: string,
    userRef: string,
    document: { bytes: Buffer; mimeType: string; idempotencyKey: string },
    trace: Pick<TraceContext, 'traceId'>,
  ): Promise<StoredDocument> {
    const url = new URL(`internal/v1/requests/${encodeURIComponent(requestId)}/documents`, this.config.backendUrl.href.replace(/\/?$/, '/'));
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.tokens.get('tooling-documents')}`,
          traceparent: childTraceparent(trace),
          Accept: 'application/json',
          'Content-Type': 'application/octet-stream',
          'Idempotency-Key': document.idempotencyKey,
          'X-User-Ref': userRef,
          'X-File-Mime-Type': document.mimeType,
        },
        body: new Uint8Array(document.bytes),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      this.logger.error(`Backend injoignable pour un document délivré : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    }
    if (res.status === 401 || res.status === 403) {
      this.tokens.invalidate('tooling-documents');
      this.logger.error(`Backend refuse l'identité tooling-documents : HTTP ${res.status}`);
    }
    if (res.status !== 201) {
      await res.body?.cancel();
      this.logger.error(`Document délivré non transmis au Backend : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Document délivré non transmis');
    }
    const stored = (await res.json().catch(() => undefined)) as unknown;
    if (!fileSchema(stored)) throw this.nonConforming(`document délivré (${errorsText(fileSchema)})`);
    return stored as StoredDocument;
  }

  private async get(path: string, trace: TraceContext, notFound = 'Ressource inconnue', extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(path, this.config.backendUrl.href.replace(/\/?$/, '/'));
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await this.tokens.get('tooling-resources')}`,
          traceparent: childTraceparent(trace),
          Accept: 'application/json',
          ...extraHeaders,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      this.logger.error(`Backend injoignable : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    }
    if (res.status === 404) throw new ProblemError(404, 'NOT_FOUND', notFound);
    if (res.status === 401 || res.status === 403) {
      this.tokens.invalidate('tooling-resources');
      this.logger.error(`Backend refuse l'identité tooling-resources : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    }
    if (!res.ok) {
      this.logger.error(`Backend en erreur : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    }
    try {
      return await res.json();
    } catch {
      throw this.nonConforming('JSON');
    }
  }

  private nonConforming(what: string): ProblemError {
    this.logger.error(`Réponse Backend non conforme : ${what}`);
    return new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Réponse amont non conforme');
  }
}
