import { readFileSync } from "node:fs";
import { Problem, approvedMcpUrl, type ModelConfig } from "./domain.js";
import type { ToolDefinition } from "./tooling.js";

export type ModelCall = { id: string; name: string; arguments: string };
export type Turn = {
  role: "user" | "assistant" | "tool";
  content: string;
  calls?: ModelCall[];
  callId?: string;
  rawOutput?: unknown[];
};
export type ModelReply = {
  text: string;
  calls: ModelCall[];
  rawOutput?: unknown[];
};
export interface ModelPort {
  generate(
    config: ModelConfig,
    history: Turn[],
    tools: ToolDefinition[],
  ): Promise<ModelReply>;
}
export type Provider = {
  baseUrl: string;
  protocol: "responses" | "chat-completions";
  apiKeyEnv?: string;
  omitTemperature?: boolean;
};
export class HttpModels implements ModelPort {
  constructor(
    private providers: Record<string, Provider>,
    private environment: NodeJS.ProcessEnv = process.env,
  ) {
    for (const provider of Object.values(providers))
      if (
        !approvedMcpUrl(
          provider.baseUrl,
          new Set([new URL(provider.baseUrl).href]),
        )
      )
        throw new Error("Model endpoint requires HTTPS outside localhost.");
  }
  async generate(
    config: ModelConfig,
    history: Turn[],
    tools: ToolDefinition[],
  ): Promise<ModelReply> {
    const wireName = (name: string) => name.replaceAll(".", "_");
    const toolNames = new Map(
      tools.map((tool) => [wireName(tool.name), tool.name]),
    );
    const provider = this.providers[config.provider];
    if (!provider)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Fournisseur de modèle non configuré.",
      );
    if (!/^[a-zA-Z0-9_-]+$/.test(config.promptVersion))
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Version de prompt inconnue.",
      );
    const prompt = readFileSync(
      new URL(
        "./assets/prompts/" + config.promptVersion + ".txt",
        import.meta.url,
      ),
      "utf8",
    );
    const apiKey = provider.apiKeyEnv
      ? this.environment[provider.apiKeyEnv]
      : undefined;
    if (provider.apiKeyEnv && !apiKey)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Secret du fournisseur manquant.",
      );
    const common = {
      model: config.model,
      ...(!provider.omitTemperature ? { temperature: config.temperature } : {}),
    };
    const responses = provider.protocol === "responses";
    let body: Record<string, unknown>;
    if (responses) {
      const input = history.flatMap((turn) => {
        if (turn.role === "tool")
          return [
            {
              type: "function_call_output",
              call_id: turn.callId,
              output: turn.content,
            },
          ];
        if (turn.rawOutput) return turn.rawOutput as Record<string, unknown>[];
        return [{ role: turn.role, content: turn.content }];
      });
      body = {
        ...common,
        instructions: prompt,
        input,
        store: false,
        max_output_tokens: 2000,
        tools: tools.map((tool) => ({
          type: "function",
          name: wireName(tool.name),
          description: tool.description,
          parameters: tool.inputSchema,
          strict: false,
        })),
      };
    } else
      body = {
        ...common,
        max_tokens: 2000,
        messages: [
          { role: "system", content: prompt },
          ...history.map((turn) =>
            turn.role === "tool"
              ? {
                  role: "tool",
                  tool_call_id: turn.callId,
                  content: turn.content,
                }
              : {
                  role: turn.role,
                  content: turn.content || null,
                  ...(turn.calls?.length
                    ? {
                        tool_calls: turn.calls.map((call) => ({
                          id: call.id,
                          type: "function",
                          function: {
                            name: wireName(call.name),
                            arguments: call.arguments,
                          },
                        })),
                      }
                    : {}),
                },
          ),
        ],
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: wireName(tool.name),
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      };
    const base = provider.baseUrl.endsWith("/")
      ? provider.baseUrl
      : provider.baseUrl + "/";
    const res = await fetch(
      new URL(responses ? "responses" : "chat/completions", base),
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!res.ok)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Appel au modèle interrompu ou refusé.",
      );
    const text = await res.text();
    if (Buffer.byteLength(text) > 1048576)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Réponse modèle trop volumineuse.",
      );
    const value = JSON.parse(text);
    if (responses) {
      if (!Array.isArray(value.output))
        throw new Problem(
          503,
          "UPSTREAM_UNAVAILABLE",
          "Réponse modèle invalide.",
        );
      return {
        text: value.output
          .filter((item: any) => item.type === "message")
          .flatMap((item: any) => item.content ?? [])
          .filter((item: any) => item.type === "output_text")
          .map((item: any) => item.text)
          .join(""),
        calls: value.output
          .filter((item: any) => item.type === "function_call")
          .map((item: any) => ({
            id: item.call_id,
            name: toolNames.get(item.name) ?? item.name,
            arguments: item.arguments,
          })),
        rawOutput: value.output,
      };
    }
    const message = value.choices?.[0]?.message;
    if (!message)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Réponse modèle invalide.",
      );
    return {
      text: typeof message.content === "string" ? message.content : "",
      calls: (message.tool_calls ?? []).map((call: any) => ({
        id: call.id,
        name: toolNames.get(call.function?.name) ?? call.function?.name,
        arguments: call.function?.arguments,
      })),
    };
  }
}
export function redact(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(
      /(?<![A-Za-z0-9_])\+?\d[\d .()-]{6,}\d(?![A-Za-z0-9_])/g,
      "[IDENTIFIANT]",
    )
    .replace(
      /\b(?:npi|otp|code\s*sms|mot de passe)\s*[:=]?\s*\S+/gi,
      "[INFORMATION MASQUÉE]",
    );
}
