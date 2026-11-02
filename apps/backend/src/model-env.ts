import type { Pool } from "pg";
import { validate, type ModelConfig } from "./domain.js";

type Preset = {
  id: string;
  env: string;
  label: string;
  baseUrl: string;
  model: string;
};

/** OpenAI-compatible providers. The filled API key selects the endpoint and the default model. */
const PRESETS: Preset[] = [
  { id: "groq", env: "GROQ_API_KEY", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "openai", env: "OPENAI_API_KEY", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "openrouter", env: "OPENROUTER_API_KEY", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { id: "mistral", env: "MISTRAL_API_KEY", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  { id: "deepseek", env: "DEEPSEEK_API_KEY", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "gemini", env: "GEMINI_API_KEY", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
];

function filled(env: NodeJS.ProcessEnv, name: string): boolean {
  return Boolean(env[name]?.trim());
}

/** The active model comes from the environment. The secret itself stays out of the database. */
export function resolveModelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig | undefined {
  const protocol = env.MODEL_PROTOCOL === "responses" ? "responses" : "chat-completions";
  if (filled(env, "MODEL_API_KEY")) {
    const baseUrl = env.MODEL_BASE_URL?.trim().replace(/\/$/, "");
    const model = env.MODEL_NAME?.trim();
    if (!baseUrl || !model)
      throw new Error("MODEL_API_KEY exige MODEL_BASE_URL et MODEL_NAME.");
    return {
      id: "env",
      label: "Modèle d'environnement",
      baseUrl,
      protocol,
      model,
      apiKeyRef: "MODEL_API_KEY",
      temperature: 0.2,
      active: true,
    };
  }
  const present = PRESETS.filter((preset) => filled(env, preset.env));
  if (!present.length) return undefined;
  const requested = env.MODEL_PROVIDER?.trim().toLowerCase();
  const chosen = requested
    ? present.find((preset) => preset.id === requested)
    : present.length === 1
      ? present[0]
      : undefined;
  if (!chosen)
    throw new Error(
      requested
        ? `MODEL_PROVIDER=${requested} n'a pas de clé. Clés présentes : ${present.map((preset) => preset.env).join(", ")}.`
        : `Une seule clé modèle à la fois. Présentes : ${present.map((preset) => preset.env).join(", ")}. Retirer les autres, ou préciser MODEL_PROVIDER.`,
    );
  return {
    id: "env",
    label: chosen.label,
    baseUrl: (env.MODEL_BASE_URL?.trim() || chosen.baseUrl).replace(/\/$/, ""),
    protocol,
    model: env.MODEL_NAME?.trim() || chosen.model,
    apiKeyRef: chosen.env,
    temperature: 0.2,
    active: true,
  };
}

/** Replaces the active model for new messages. An empty environment leaves an operator configuration untouched. */
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
  console.log(`Modèle actif : ${model.label} / ${model.model} (clé ${model.apiKeyRef}).`);
}
