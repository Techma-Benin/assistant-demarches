import type { McpAuth, McpServer, ModelConfig } from './api';

/** Same patterns as the contract (operator.openapi.json). */
export const ENV_NAME = /^[A-Z][A-Z0-9_]{1,100}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export const ENV_NAME_ERROR =
  'Un nom de variable : majuscules, chiffres et _ (ex. GROQ_API_KEY). Ne collez jamais la clé elle-même.';

/** Stable id from a label: ASCII slug, made unique against `taken`. */
export function makeId(label: string, taken: readonly string[]): string {
  const slug =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'element';
  let id = slug;
  for (let n = 2; taken.includes(id); n += 1) id = `${slug}-${n}`;
  return id;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

// ---- Models ---------------------------------------------------------------

export interface ModelFormValues {
  label: string;
  baseUrl: string;
  protocol: ModelConfig['protocol'];
  model: string;
  apiKey: string;
  role: 'discussion' | 'transcription';
}

export type ModelFormErrors = Partial<Record<keyof ModelFormValues, string>>;

export const emptyModelForm: ModelFormValues = {
  label: '',
  baseUrl: '',
  protocol: 'chat-completions',
  model: '',
  apiKey: '',
  role: 'discussion',
};

export const API_KEY_ERROR = 'Indiquez la clé d’accès du fournisseur.';

/** Internal env-shaped name kept on the contract. The operator never types it. */
export function modelKeyRef(id: string): string {
  const slug = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'MODEL';
  return `MDL_${slug}`.slice(0, 101);
}

export function modelToForm(model: ModelConfig): ModelFormValues {
  return {
    label: model.label,
    baseUrl: model.baseUrl,
    protocol: model.protocol,
    model: model.model,
    apiKey: '',
    role: model.role === 'transcription' ? 'transcription' : 'discussion',
  };
}

export function validateModelForm(
  values: ModelFormValues,
  base: { id: string; active: boolean; apiKeyRef?: string; temperature?: number },
  options: { requireKey: boolean },
): { errors: ModelFormErrors; model?: ModelConfig; apiKey?: string } {
  const errors: ModelFormErrors = {};
  const label = values.label.trim();
  const baseUrl = values.baseUrl.trim();
  const model = values.model.trim();
  const apiKey = values.apiKey.trim();
  if (!label || label.length > 200) errors.label = 'Indiquez un nom (200 caractères au plus).';
  if (!isHttpUrl(baseUrl)) errors.baseUrl = 'Indiquez une adresse valide, par exemple https://api.groq.com/openai/v1.';
  if (!model || model.length > 200) errors.model = 'Indiquez l’identifiant du modèle (200 caractères au plus).';
  if (options.requireKey && !apiKey) errors.apiKey = API_KEY_ERROR;
  if (values.role !== 'discussion' && values.role !== 'transcription') errors.role = 'Choisissez un rôle.';
  if (!ID.test(base.id)) errors.label = 'Nom inutilisable : choisissez des lettres ou des chiffres.';
  const apiKeyRef = base.apiKeyRef && ENV_NAME.test(base.apiKeyRef) ? base.apiKeyRef : modelKeyRef(base.id);
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    apiKey: apiKey || undefined,
    model: {
      id: base.id,
      label,
      baseUrl,
      protocol: values.protocol,
      model,
      apiKeyRef,
      temperature: typeof base.temperature === 'number' ? base.temperature : 0,
      role: values.role,
      active: base.active,
    },
  };
}

// ---- MCP servers ----------------------------------------------------------

export type McpAuthType = McpAuth['type'];

export interface ServerFormValues {
  name: string;
  url: string;
  authType: McpAuthType;
  secretRef: string;
  tokenUrl: string;
  clientId: string;
  clientSecretRef: string;
  scope: string;
}

export type ServerFormErrors = Partial<Record<keyof ServerFormValues, string>>;

export const emptyServerForm: ServerFormValues = {
  name: '',
  url: '',
  authType: 'none',
  secretRef: '',
  tokenUrl: '',
  clientId: '',
  clientSecretRef: '',
  scope: '',
};

export function serverToForm(server: McpServer): ServerFormValues {
  const base: ServerFormValues = { ...emptyServerForm, name: server.name, url: server.url };
  const auth = server.auth;
  if (auth.type === 'bearer') return { ...base, authType: 'bearer', secretRef: auth.secretRef };
  if (auth.type === 'oauth-client-credentials') {
    return {
      ...base,
      authType: 'oauth-client-credentials',
      tokenUrl: auth.tokenUrl,
      clientId: auth.clientId,
      clientSecretRef: auth.clientSecretRef,
      scope: auth.scope ?? '',
    };
  }
  return base;
}

export function validateServerForm(
  values: ServerFormValues,
  id: string,
): { errors: ServerFormErrors; server?: McpServer } {
  const errors: ServerFormErrors = {};
  const name = values.name.trim();
  const url = values.url.trim();
  if (!name || name.length > 200) errors.name = 'Indiquez un nom (200 caractères au plus).';
  if (!isHttpUrl(url)) errors.url = 'Indiquez l’adresse du serveur, par exemple https://mcp.exemple.bj/mcp.';
  let auth: McpAuth = { type: 'none' };
  if (values.authType === 'bearer') {
    if (!ENV_NAME.test(values.secretRef.trim())) errors.secretRef = ENV_NAME_ERROR;
    auth = { type: 'bearer', secretRef: values.secretRef.trim() };
  } else if (values.authType === 'oauth-client-credentials') {
    if (!isHttpUrl(values.tokenUrl.trim())) errors.tokenUrl = 'Indiquez une adresse valide.';
    if (!values.clientId.trim() || values.clientId.trim().length > 200) errors.clientId = 'Indiquez l’identifiant client.';
    if (!ENV_NAME.test(values.clientSecretRef.trim())) errors.clientSecretRef = ENV_NAME_ERROR;
    auth = {
      type: 'oauth-client-credentials',
      tokenUrl: values.tokenUrl.trim(),
      clientId: values.clientId.trim(),
      clientSecretRef: values.clientSecretRef.trim(),
      scope: values.scope.trim() || null,
    };
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { errors, server: { id, name, url, enabled: true, auth } };
}
