import { fileURLToPath } from 'node:url';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  backendUrl: string;
  meta: {
    appSecret: string;
    verifyToken: string;
    accessToken?: string;
    phoneNumberId?: string;
    graphVersion: string;
    /** Envoi réel via l’API Graph (sinon expéditeur en mémoire, dev/tests uniquement). */
    useGraphApi: boolean;
  };
  subjectHmacKey: string;
  callback: { jwksUrl?: string; issuer?: string };
  mockUserToken?: string;
  contractsDir: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuration invalide :\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

// Valeurs de développement publiques : refusées en production (les variables y sont obligatoires).
const DEV_DEFAULTS = {
  appSecret: 'dev-meta-app-secret',
  verifyToken: 'dev-meta-verify-token',
  hmacKey: 'dev-subject-hmac-key-0123456789abcdef',
  graphVersion: 'v23.0',
  mockUserToken: 'mock-user',
};

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

const clean = (v: string | undefined): string | undefined => (v && v.trim() !== '' ? v.trim() : undefined);

/** Valide l’environnement au démarrage ; les messages ne contiennent jamais de valeur secrète. */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const problems: string[] = [];
  const nodeEnv = clean(env['NODE_ENV']) ?? 'development';
  const isProduction = nodeEnv === 'production';

  const rawPort = clean(env['PORT']) ?? '4030';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push('PORT doit être un entier entre 0 et 65535.');

  const backendUrl = (clean(env['BACKEND_URL']) ?? 'http://127.0.0.1:4010').replace(/\/+$/, '');
  try {
    const url = new URL(backendUrl);
    if (!['http:', 'https:'].includes(url.protocol)) problems.push('BACKEND_URL doit utiliser http ou https.');
    else if (url.protocol === 'http:' && !isLoopbackHost(url.hostname))
      problems.push('BACKEND_URL doit utiliser HTTPS hors localhost.');
  } catch {
    problems.push('BACKEND_URL n’est pas une URL valide.');
  }

  const required = (name: string, devDefault?: string): string => {
    const value = clean(env[name]);
    if (value) return value;
    if (isProduction || devDefault === undefined) {
      if (isProduction) problems.push(`${name} est obligatoire en production.`);
      return '';
    }
    return devDefault;
  };

  const appSecret = required('META_APP_SECRET', DEV_DEFAULTS.appSecret);
  const verifyToken = required('META_VERIFY_TOKEN', DEV_DEFAULTS.verifyToken);
  const graphVersion = required('META_GRAPH_VERSION', DEV_DEFAULTS.graphVersion);
  const subjectHmacKey = required('SUBJECT_HMAC_KEY', DEV_DEFAULTS.hmacKey);
  if (subjectHmacKey && subjectHmacKey.length < 32) problems.push('SUBJECT_HMAC_KEY doit contenir au moins 32 caractères.');

  const accessToken = isProduction ? required('META_ACCESS_TOKEN') : clean(env['META_ACCESS_TOKEN']);
  const phoneNumberId = isProduction ? required('META_PHONE_NUMBER_ID') : clean(env['META_PHONE_NUMBER_ID']);
  const jwksUrl = isProduction ? required('CALLBACK_JWKS_URL') : clean(env['CALLBACK_JWKS_URL']);
  const issuer = isProduction ? required('CALLBACK_ISSUER') : clean(env['CALLBACK_ISSUER']);
  if (jwksUrl) {
    try {
      new URL(jwksUrl);
    } catch {
      problems.push('CALLBACK_JWKS_URL n’est pas une URL valide.');
    }
  }

  const mockUserToken = clean(env['MOCK_USER_TOKEN']);
  if (isProduction && mockUserToken) problems.push('MOCK_USER_TOKEN est refusé en production (jeton de simulation).');

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    port,
    nodeEnv,
    isProduction,
    backendUrl,
    meta: {
      appSecret,
      verifyToken,
      ...(accessToken ? { accessToken } : {}),
      ...(phoneNumberId ? { phoneNumberId } : {}),
      graphVersion,
      useGraphApi: isProduction || Boolean(accessToken && phoneNumberId),
    },
    subjectHmacKey,
    callback: { ...(jwksUrl ? { jwksUrl } : {}), ...(issuer ? { issuer } : {}) },
    ...(isProduction ? {} : { mockUserToken: mockUserToken ?? DEV_DEFAULTS.mockUserToken }),
    // src/config/ ou dist/config/ -> racine du dépôt -> contracts/v1
    contractsDir:
      clean(env['CONTRACTS_DIR']) ?? fileURLToPath(new URL('../../../../../contracts/v1', import.meta.url)),
  };
}
