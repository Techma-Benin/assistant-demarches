import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { ServiceTokens } from '../auth/service-tokens.js';
import { ProblemError } from '../common/problem.js';
import { childTraceparent, type TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { domainValidator, errorsText } from '../contracts.js';

export interface FileMetadata {
  id: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
}

const fileAccess = domainValidator('FileAccess');
const MAX_FILE_BYTES = 10 * 1024 * 1024;

@Injectable()
export class BackendClient {
  private readonly logger = new Logger(BackendClient.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly tokens: ServiceTokens,
  ) {}

  async getFile(fileId: string, userRef: string, trace: Pick<TraceContext, 'traceId'>): Promise<FileMetadata> {
    const res = await this.call(`internal/v1/files/${encodeURIComponent(fileId)}`, userRef, trace, 'application/json');
    const access = (await res.json().catch(() => undefined)) as unknown;
    if (!fileAccess(access)) throw this.nonConforming(`FileAccess (${errorsText(fileAccess)})`);
    const found = access as { file: FileMetadata; userRef: string };
    if (found.file.id !== fileId) throw this.nonConforming('pièce demandée');
    if (found.userRef !== userRef) throw new ProblemError(404, 'NOT_FOUND', 'Pièce inconnue');
    return found.file;
  }

  async fileContent(fileId: string, userRef: string, trace: Pick<TraceContext, 'traceId'>): Promise<Buffer> {
    const res = await this.call(`internal/v1/files/${encodeURIComponent(fileId)}/content`, userRef, trace, '*/*');
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) throw this.nonConforming('pièce trop volumineuse');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw this.nonConforming('contenu de pièce');
    return bytes;
  }

  private async call(path: string, userRef: string, trace: Pick<TraceContext, 'traceId'>, accept: string): Promise<Response> {
    const url = new URL(path, this.config.backendUrl.href.replace(/\/?$/, '/'));
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.tokens.get()}`, traceparent: childTraceparent(trace), Accept: accept, 'X-User-Ref': userRef },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      this.logger.error(`Backend injoignable : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    }
    if (res.status === 404) {
      await res.body?.cancel();
      throw new ProblemError(404, 'NOT_FOUND', 'Pièce inconnue');
    }
    if (res.status === 401 || res.status === 403) this.tokens.invalidate();
    if (!res.ok) {
      await res.body?.cancel();
      this.logger.error(`Backend en erreur : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Service Backend indisponible');
    }
    return res;
  }

  private nonConforming(what: string): ProblemError {
    this.logger.error(`Réponse Backend non conforme : ${what}`);
    return new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Réponse amont non conforme');
  }
}

@Global()
@Module({ providers: [BackendClient], exports: [BackendClient] })
export class BackendModule {}
