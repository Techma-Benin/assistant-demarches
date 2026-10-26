import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ProblemException } from '../common/problem.js';
import { CALLBACK_TOKEN_VERIFIER } from '../tokens.js';
import { CallbackAuthError, type CallbackTokenVerifier } from './callback-auth.js';

@Injectable()
export class CallbackAuthGuard implements CanActivate {
  constructor(@Inject(CALLBACK_TOKEN_VERIFIER) private readonly verifier: CallbackTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const header = req.headers['authorization'];
    const match = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
    if (!match) throw new ProblemException(401, 'UNAUTHORIZED', 'Jeton d’authentification requis');
    try {
      await this.verifier.verify(match[1]!);
    } catch (error) {
      if (error instanceof CallbackAuthError && error.kind === 'FORBIDDEN')
        throw new ProblemException(403, 'FORBIDDEN', 'Droits insuffisants');
      throw new ProblemException(401, 'UNAUTHORIZED', 'Jeton invalide');
    }
    return true;
  }
}
