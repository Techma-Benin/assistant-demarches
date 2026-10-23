export type AuthMode = 'jwt' | 'mock-tokens';

export interface ToolingConfig {
  host: string;
  port: number;
  production: boolean;
  authMode: AuthMode;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export class ConfigError extends Error {}

/** Lit et valide l'environnement. Toute incohérence empêche le démarrage. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ToolingConfig {
  const production = env.NODE_ENV === 'production';
  const host = env.TOOLING_HOST ?? '127.0.0.1';
  const port = Number(env.TOOLING_PORT ?? 4030);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('TOOLING_PORT invalide');

  const authMode = (env.AUTH_MODE ?? 'jwt') as AuthMode;
  if (authMode !== 'jwt' && authMode !== 'mock-tokens') throw new ConfigError('AUTH_MODE doit valoir jwt ou mock-tokens');
  if (authMode === 'mock-tokens' && (production || !LOCAL_HOSTS.has(host))) {
    throw new ConfigError('AUTH_MODE=mock-tokens est réservé à une écoute locale hors production');
  }
  return { host, port, production, authMode };
}
