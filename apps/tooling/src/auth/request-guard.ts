import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemError } from '../common/problem.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { RateLimiter } from './rate-limiter.js';
import { ServiceAuth, type InboundScope, type Principal } from './service-auth.js';

@Injectable()
export class RequestGuard {
  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly auth: ServiceAuth,
    private readonly limits: RateLimiter,
  ) {}

  async authorize(req: Request, scope: InboundScope): Promise<Principal> {
    const failures = `auth-failure:${req.ip ?? 'unknown'}`;
    const blocked = await this.limits.exceeded(failures, this.config.rateLimits.authFailuresPerIp);
    if (!blocked.allowed) throw new ProblemError(429, 'RATE_LIMITED', "Trop d'échecs d'authentification", blocked.retryAfter);

    const authorization = req.headers.authorization;
    let principal: Principal;
    try {
      principal = await this.auth.require(typeof authorization === 'string' ? authorization : undefined, scope);
    } catch (error) {
      if (error instanceof ProblemError && error.status === 401) await this.limits.hit(failures, this.config.rateLimits.authFailuresPerIp);
      throw error;
    }

    const quota = await this.limits.hit(`client:${principal.client}`, this.config.rateLimits.perClient);
    if (!quota.allowed) throw new ProblemError(429, 'RATE_LIMITED', 'Débit maximal atteint pour ce client', quota.retryAfter);
    return principal;
  }
}
