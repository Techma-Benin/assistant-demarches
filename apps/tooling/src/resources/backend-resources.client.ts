import { Inject, Injectable, Logger } from '@nestjs/common';
import { ServiceTokens } from '../auth/service-tokens.js';
import { ProblemError } from '../common/problem.js';
import { childTraceparent, type TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';

export interface Procedure {
  id: string;
  validationStatus: 'draft' | 'validated';
  [field: string]: unknown;
}

/** Client de l'API privée Backend (backend-resources.openapi.json), identité tooling-resources. */
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
    return items as Procedure[];
  }

  async getProcedure(procedureId: string, trace: TraceContext): Promise<Procedure> {
    return (await this.get(`internal/v1/procedures/${encodeURIComponent(procedureId)}`, trace, 'Fiche inconnue')) as Procedure;
  }

  private async get(path: string, trace: TraceContext, notFound = 'Ressource inconnue'): Promise<unknown> {
    const url = new URL(path, this.config.backendUrl.href.replace(/\/?$/, '/'));
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await this.tokens.get('tooling-resources')}`,
          traceparent: childTraceparent(trace),
          Accept: 'application/json',
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
      // Erreur de configuration d'identité : alerte côté serveur, jeton redemandé au prochain appel.
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
