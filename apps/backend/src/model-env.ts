import type { Pool } from "pg";
import { validate, type ModelConfig } from "./domain.js";

type Preset = { label: string; baseUrl: string; model: string };

/** Defaults used when MODEL_PROVIDER is set and the URL or model name is left empty. */
const PRESETS: Record<string, Preset> = {
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  gemini: { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
};

function filled(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/** One secret, MODEL_API_KEY. Provider, URL and model name are optional. */
export function resolveModelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig | undefined {
  if (!filled(env.MODEL_API_KEY)) return undefined;
  const protocol = env.MODEL_PROTOCOL === "responses" ? "responses" : "chat-completions";
  const provider = filled(env.MODEL_PROVIDER)?.toLowerCase() ?? "groq";
  const preset = PRESETS[provider];
  const baseUrl = filled(env.MODEL_BASE_URL)?.replace(/\/$/, "") ?? preset?.baseUrl;
  const model = filled(env.MODEL_NAME) ?? preset?.model;
  if (!baseUrl || !model)
    throw new Error(`Fournisseur « ${provider} » inconnu. Précisez MODEL_BASE_URL et MODEL_NAME.`);
  return {
    id: "env",
    label: preset?.label ?? provider,
    baseUrl,
    protocol,
    model,
    apiKeyRef: "MODEL_API_KEY",
    temperature: 0.2,
    active: true,
  };
}

/** Replaces the active model for new messages. No key leaves an operator configuration untouched. */
export async function syncEnvModel(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const model = resolveModelFromEnv(env);
  if (!model) return;
  validate("ModelConfig", model);
  await pool.query(
    "UPDATE backend_configurations SET body=jsonb_set(body,'{active}','false'::jsonb), updated_at=now() WHERE administration_id='global' AND resource='models' AND resource_id<>$1 AND body->>'active'='true'",
    [model.id],
  );
  await pool.query(
    "INSERT INTO backend_configurations(administration_id,resource,resource_id,body) VALUES('global','models',$1,$2) ON CONFLICT(administration_id,resource,resource_id) DO UPDATE SET body=excluded.body, updated_at=now()",
    [model.id, model],
  );
  console.log(`Modèle actif : ${model.label} / ${model.model}.`);
}
