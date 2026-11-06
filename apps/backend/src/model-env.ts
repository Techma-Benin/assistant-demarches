import type { Pool, PoolClient } from "pg";
import { canonical, validate, type ModelConfig } from "./domain.js";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export function modelsLockKey(administrationId: string): string {
  return canonical([administrationId, "models"]);
}

export type ModelRole = "discussion" | "transcription";

/** Missing or legacy role counts as discussion. */
export function modelRole(body: { role?: unknown } | null | undefined): ModelRole {
  return body?.role === "transcription" ? "transcription" : "discussion";
}

/** Clears `active` on the other models of the same role. `exceptId` stays as the caller left it. */
export async function deactivateOtherModels(
  db: Db,
  administrationId: string,
  exceptId: string,
  role: ModelRole,
): Promise<void> {
  await db.query(
    "UPDATE backend_configurations SET body=jsonb_set(body,'{active}','false'::jsonb), updated_at=now() WHERE administration_id=$1 AND resource='models' AND resource_id<>$2 AND body->>'active'='true' AND CASE WHEN body->>'role'='transcription' THEN 'transcription' ELSE 'discussion' END=$3",
    [administrationId, exceptId, role],
  );
}

type Preset = { label: string; baseUrl: string; model: string };

/** Defaults used when MODEL_PROVIDER is set and the URL or model name is left empty. */
const PRESETS: Record<string, Preset> = {
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "qwen/qwen3.8-27b" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  gemini: { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash" },
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
    role: "discussion",
    active: true,
  };
}

/** Replaces the active model for new messages. No key leaves an operator configuration untouched. */
export async function syncEnvModel(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const model = resolveModelFromEnv(env);
  if (!model) return;
  validate("ModelConfig", model);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      modelsLockKey("global"),
    ]);
    await deactivateOtherModels(client, "global", model.id, modelRole(model));
    await client.query(
      "INSERT INTO backend_configurations(administration_id,resource,resource_id,body) VALUES('global','models',$1,$2) ON CONFLICT(administration_id,resource,resource_id) DO UPDATE SET body=excluded.body, updated_at=now()",
      [model.id, model],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log(`Modèle actif : ${model.label} / ${model.model}.`);
}
