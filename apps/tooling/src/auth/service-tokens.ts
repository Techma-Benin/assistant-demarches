import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import { TOOLING_CONFIG, type OutboundClient, type ToolingConfig } from '../config.js';

interface CachedToken {
  value: string;
  expiresAt: number;
}

const REFRESH_MARGIN_MS = 30_000;

/** Jetons des identités sortantes du Tooling, obtenus par client credentials et mis en cache. */
@Injectable()
export class ServiceTokens {
  private readonly logger = new Logger(ServiceTokens.name);
  private readonly cache = new Map<OutboundClient, CachedToken>();
  private readonly pending = new Map<OutboundClient, Promise<string>>();

  constructor(@Inject(TOOLING_CONFIG) private readonly config: ToolingConfig) {}

  async get(client: OutboundClient): Promise<string> {
    if (!this.config.jwt) return `mock-${client}`;
    const cached = this.cache.get(client);
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.value;
    // Une seule requête au fournisseur pour des appels concurrents.
    let pending = this.pending.get(client);
    if (!pending) {
      pending = this.fetchToken(client).finally(() => this.pending.delete(client));
      this.pending.set(client, pending);
    }
    return pending;
  }

  /** À appeler quand l'aval refuse le jeton : le suivant sera redemandé. */
  invalidate(client: OutboundClient): void {
    this.cache.delete(client);
  }

  private async fetchToken(client: OutboundClient): Promise<string> {
    const jwt = this.config.jwt!;
    const credentials = jwt.clients[client];
    let res: Response;
    try {
      res = await fetch(jwt.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: credentials.id,
          client_secret: credentials.secret,
          scope: credentials.scope,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      this.logger.error(`Fournisseur OIDC injoignable pour ${client} : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
    const body = (await res.json().catch(() => undefined)) as { access_token?: unknown; expires_in?: unknown } | undefined;
    if (!res.ok || typeof body?.access_token !== 'string' || typeof body.expires_in !== 'number') {
      // Ne jamais journaliser le corps : il peut contenir un jeton.
      this.logger.error(`Jeton refusé pour ${client} : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
    this.cache.set(client, { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
    return body.access_token;
  }
}
