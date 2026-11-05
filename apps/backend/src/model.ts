import { DiagnosticProblem, providerReason, safeProviderIdentifier } from "./diagnostics.js";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Problem, approvedMcpUrl, type ModelConfig } from "./domain.js";
import { resolveMcpSchema, type ToolDefinition } from "./tooling.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function openaiStrictToolHost(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname;
    return host === "api.openai.com" || host.endsWith(".openai.azure.com");
  } catch {
    return false;
  }
}

function providerError(upstream: unknown): { code?: unknown; type?: unknown; status?: unknown; message?: unknown; status_code?: unknown } | undefined {
  const record = Array.isArray(upstream) ? upstream[0] : upstream;
  if (!isRecord(record)) return undefined;
  const err = isRecord(record.error) ? record.error : record;
  return isRecord(err) ? err : undefined;
}

function asToolArguments(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "{}";
  try { return JSON.stringify(value); } catch { return "{}"; }
}

/** Inline $ref and drop JSON Schema features Groq/Gemini reject on function tools. OpenAI-compatible strict hosts keep additionalProperties:false. */
export function providerToolParameters(schema: unknown, baseUrl?: string): Record<string, unknown> {
  const resolved = resolveMcpSchema(isRecord(schema) ? schema : { type: "object" });
  const keepClosedObjects = openaiStrictToolHost(baseUrl);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isRecord(value)) return value;
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key === "$defs" || key === "$id" || key === "$schema" || key === "$ref") continue;
      if (key === "additionalProperties" && nested === false && !keepClosedObjects) continue;
      next[key] = walk(nested);
    }
    if (Array.isArray(next.type)) {
      const types = (next.type as unknown[]).filter((item) => item !== "null");
      if (types.length <= 1) next.type = types[0] ?? "string";
      else {
        next.anyOf = types.map((type) => ({ type }));
        delete next.type;
      }
    }
    return next;
  };
  const cleaned = walk(resolved);
  return isRecord(cleaned) ? cleaned : { type: "object" };
}

export type ModelCall = { id: string; name: string; arguments: string; thoughtSignature?: string };
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
export type GenerateOptions = {
  /** Called with each piece of assistant text as the provider streams it (turns the request into a stream). */
  onTextDelta?: (delta: string) => void | Promise<void>;
  /** Called once, as soon as the provider starts a tool call in this turn: the turn is a tool turn, not a final answer. */
  onToolCall?: () => void;
  /** Ask the provider for a JSON envelope when it supports response_format (degrades on 400). */
  structuredOutput?: boolean;
  /** Force a tool turn. Never combine with response_format. */
  toolChoice?: "auto" | "required" | { name: string };
  /** Resolved provider key. When absent, `environment[apiKeyRef]` is used. */
  apiKey?: string;
};

const AGENT_BLOCKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    blocks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: { type: "string", enum: ["text", "buttons", "form"] },
          text: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                procedureId: { type: "string" },
                url: { type: "string" },
              },
              required: ["procedureId", "url"],
            },
          },
          items: { type: "array" },
          id: { type: "string" },
          fields: { type: "array" },
        },
        required: ["type"],
      },
    },
  },
  required: ["blocks"],
} as const;

function structuredOutputHost(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname;
  return host === "api.groq.com"
    || host === "api.openai.com"
    || host === "generativelanguage.googleapis.com"
    || host.endsWith(".openai.azure.com");
}

function chatResponseFormat(kind: "json_schema" | "json_object") {
  if (kind === "json_object") return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: { name: "agent_blocks", strict: false, schema: AGENT_BLOCKS_SCHEMA },
  };
}

function responsesTextFormat(kind: "json_schema" | "json_object") {
  if (kind === "json_object") return { type: "json_object" };
  return { type: "json_schema", name: "agent_blocks", strict: false, schema: AGENT_BLOCKS_SCHEMA };
}
export interface ModelPort {
  generate(
    config: ModelConfig,
    history: Turn[],
    tools: ToolDefinition[],
    options?: GenerateOptions,
  ): Promise<ModelReply>;
}
export type Provider = {
  baseUrl: string;
  protocol: "responses" | "chat-completions";
  apiKeyEnv?: string;
  omitTemperature?: boolean;
  parallelToolCalls?: boolean;
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
    options?: GenerateOptions,
  ): Promise<ModelReply> {
    let emitted = false;
    let dropStream = Boolean(
      options?.onTextDelta
      && tools.length
      && (() => { try { return new URL(config.baseUrl).hostname === "generativelanguage.googleapis.com"; } catch { return false; } })(),
    );
    let structuredKind: false | "json_schema" | "json_object" =
      options?.structuredOutput && !tools.length && structuredOutputHost(config.baseUrl) ? "json_schema" : false;
    for (let attempt = 0; ; ) {
      // A retry after a broken stream must not replay text the listener already got: it is requested without streaming.
      const forwarded: GenerateOptions | undefined = !options?.onTextDelta || emitted || dropStream ? { ...options, onTextDelta: undefined }
        : { ...options, onTextDelta: (delta) => { emitted = true; return options.onTextDelta!(delta); } };
      try { return await this.generateOnce(config, history, tools, forwarded, structuredKind); }
      catch (error) {
        const diagnostic = error instanceof DiagnosticProblem ? error.diagnostic : undefined;
        if (structuredKind && diagnostic?.reason === "provider_request_rejected" && diagnostic.upstreamStatus === 400) {
          structuredKind = structuredKind === "json_schema" ? "json_object" : false;
          continue;
        }
        // Gemini (and some OpenAI-compat hosts) reject stream+tools with HTTP 400.
        if (!dropStream && options?.onTextDelta && tools.length && diagnostic?.httpFailure && diagnostic?.upstreamStatus === 400) {
          dropStream = true;
          continue;
        }
        const status = diagnostic?.upstreamStatus;
        if (status === 401 || status === 403 || status === 429 || diagnostic?.reason === "provider_rate_limit_or_quota" || diagnostic?.reason === "provider_authentication_failed" || diagnostic?.reason === "provider_access_forbidden")
          throw error;
        const transient = diagnostic?.reason === "provider_network_error" || diagnostic?.reason === "provider_response_invalid" || (typeof status === "number" && ([408, 425].includes(status) || status >= 500));
        if (!transient || attempt >= 2) throw error;
        // Only provider generation is retried; tool actions are handled by Agent.
        await delay(250 * 2 ** attempt);
        attempt++;
      }
    }
  }
  private async generateOnce(
    config: ModelConfig,
    history: Turn[],
    tools: ToolDefinition[],
    options?: GenerateOptions,
    structuredKind: false | "json_schema" | "json_object" = false,
  ): Promise<ModelReply> {
    const wireName = (name: string) => name.replaceAll(".", "_");
    const toolNames = new Map(
      tools.map((tool) => [wireName(tool.name), tool.name]),
    );
    const extras = Object.values(this.providers).find((item) => item.baseUrl === config.baseUrl);
    const provider: Provider = {
      baseUrl: config.baseUrl,
      protocol: config.protocol,
      apiKeyEnv: config.apiKeyRef,
      parallelToolCalls: extras?.parallelToolCalls,
    };
    const providerName = new URL(config.baseUrl).host;
    const prompt = readFileSync(
      new URL("./assets/prompts/agent-v1.txt", import.meta.url),
      "utf8",
    );
    const apiKey = options?.apiKey ?? this.environment[config.apiKeyRef];
    if (!apiKey)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Secret du fournisseur manquant.",
      );
    const common = {
      model: config.model,
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
          parameters: providerToolParameters(tool.inputSchema, provider.baseUrl),
          strict: false,
        })),
      };
    } else
      body = {
        ...common,
        max_tokens: 2000,
        messages: [
          { role: "system", content: prompt },
          ...this.chatTurns(history, wireName, provider.baseUrl),
        ],
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: wireName(tool.name),
            description: tool.description,
            parameters: providerToolParameters(tool.inputSchema, provider.baseUrl),
          },
        })),
      };
    // Groq and several OpenAI-compatible services reject an empty tools array.
    if (!tools.length) delete body.tools;
    // Mixing json_schema with tools makes Groq/Gemini skip or reject function calls.
    if (structuredKind && !tools.length) {
      if (responses) body.text = { format: responsesTextFormat(structuredKind) };
      else body.response_format = chatResponseFormat(structuredKind);
    }
    if (tools.length && options?.toolChoice && options.toolChoice !== "auto") {
      if (options.toolChoice === "required") body.tool_choice = "required";
      else if (responses) body.tool_choice = { type: "function", name: wireName(options.toolChoice.name) };
      else body.tool_choice = { type: "function", function: { name: wireName(options.toolChoice.name) } };
    }
    if (!responses && tools.length) {
      // Groq defaults this parameter to true, but its GPT-OSS models support
      // sequential tool use only. Leave other providers/models untouched.
      const sequentialGroqModel = new URL(provider.baseUrl).hostname === "api.groq.com"
        && /^openai\/gpt-oss-(?:20b|120b|safeguard-20b)$/.test(config.model);
      if (sequentialGroqModel) body.parallel_tool_calls = false;
      else if (provider.parallelToolCalls !== undefined) body.parallel_tool_calls = provider.parallelToolCalls;
    }
    const onTextDelta = options?.onTextDelta;
    if (onTextDelta) body.stream = true;
    const base = provider.baseUrl.endsWith("/")
      ? provider.baseUrl
      : provider.baseUrl + "/";
    let res: Response;
    try {
    res = await fetch(
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
    } catch (error) {
      throw new DiagnosticProblem("Connexion au fournisseur IA impossible ou expirée.", {
        stage: "model.request", provider: providerName, model: config.model,
        reason: "provider_network_error", causeCode: safeProviderIdentifier((error as any)?.cause?.code) ?? safeProviderIdentifier((error as any)?.name),
      });
    }
    if (!res.ok) {
      let upstream: any;
      // Only classify the error; never persist a provider body that may echo a prompt or secret.
      try {
        const reader = res.body?.getReader();
        if (reader) {
          let bytes = 0;
          const chunks: Uint8Array[] = [];
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 16384) break;
              chunks.push(value);
            }
            if (bytes <= 16384) upstream = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } finally { await reader.cancel().catch(() => {}); }
        }
      } catch { /* HTTP status remains useful even for a non-JSON response. */ }
      const err = providerError(upstream);
      throw new DiagnosticProblem("Appel au fournisseur IA refusé (HTTP " + res.status + ").", {
        stage: "model.response", provider: providerName, model: config.model,
        upstreamStatus: res.status,
        httpFailure: true,
        upstreamCode: safeProviderIdentifier(err?.code ?? err?.status),
        upstreamType: safeProviderIdentifier(err?.type ?? err?.status),
        upstreamRequestId: safeProviderIdentifier(res.headers.get("x-request-id") ?? res.headers.get("request-id")),
        reason: res.status === 400 && new URL(provider.baseUrl).hostname === "api.groq.com" && err?.code === "tool_use_failed"
          ? "provider_tool_generation_invalid"
          : providerReason(res.status, err?.message),
      });
    }
    if (onTextDelta) {
      return responses
        ? await this.replyFromResponsesStream(res, toolNames, onTextDelta, options?.onToolCall, providerName, config.model)
        : await this.replyFromChatStream(res, toolNames, onTextDelta, options?.onToolCall, providerName, config.model);
    }
    let text: string;
    try { text = await res.text(); }
    catch {
      throw new DiagnosticProblem("Lecture de la réponse fournisseur interrompue.", {
        stage: "model.response", provider: providerName, model: config.model,
        reason: "provider_network_error",
      });
    }
    if (Buffer.byteLength(text) > 1048576)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Réponse modèle trop volumineuse.",
      );
    let value: any;
    try { value = JSON.parse(text); }
    catch {
      throw new DiagnosticProblem("Réponse fournisseur hors contrat JSON.", {
        stage: "model.response", provider: providerName, model: config.model,
        reason: "provider_response_invalid",
      });
    }
    const envelope = providerError(value);
    if (envelope && (envelope.message || envelope.code || envelope.status) && !value?.choices && !value?.output) {
      throw this.providerEnvelopeError(providerName, config.model, { ...envelope, status_code: typeof envelope.status === "number" ? envelope.status : 400 });
    }
    return responses
      ? this.replyFromResponses(value, toolNames, providerName, config.model)
      : this.replyFromChat(value, toolNames, providerName, config.model);
  }
  private invalidModelResponse(providerName: string, model: string) {
    return new DiagnosticProblem("Réponse modèle invalide.", {
      stage: "model.response", provider: providerName, model,
      reason: "provider_response_invalid",
    });
  }
  private providerEnvelopeError(providerName: string, model: string, upstream: any) {
    const status = typeof upstream?.status_code === "number" ? upstream.status_code : 400;
    return new DiagnosticProblem("Appel au fournisseur IA refusé (HTTP " + status + ").", {
      stage: "model.response", provider: providerName, model,
      upstreamStatus: status,
      upstreamCode: safeProviderIdentifier(upstream?.code),
      upstreamType: safeProviderIdentifier(upstream?.type),
      reason: status === 400 && providerName === "api.groq.com" && upstream?.code === "tool_use_failed"
        ? "provider_tool_generation_invalid"
        : providerReason(status, upstream?.message),
    });
  }
  private replyFromResponses(value: any, toolNames: Map<string, string>, providerName: string, model: string): ModelReply {
    if (!Array.isArray(value?.output) || value.output.some((item: unknown) => !item || typeof item !== "object"))
      throw this.invalidModelResponse(providerName, model);
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
  private geminiHost(baseUrl: string): boolean {
    try { return new URL(baseUrl).hostname === "generativelanguage.googleapis.com"; }
    catch { return false; }
  }
  private thoughtSignature(call: any): string | undefined {
    const extra = call?.extra_content?.google?.thought_signature ?? call?.thought_signature ?? call?.thoughtSignature;
    return typeof extra === "string" && extra ? extra : undefined;
  }
  private chatTurns(history: Turn[], wireName: (name: string) => string, baseUrl: string): Record<string, unknown>[] {
    const unsigned = new Set(
      history.flatMap((turn) => turn.role === "assistant" ? (turn.calls ?? []).filter((call) => !call.thoughtSignature).map((call) => call.id) : []),
    );
    const flatten = this.geminiHost(baseUrl);
    const out: Record<string, unknown>[] = [];
    for (const turn of history) {
      if (turn.role === "tool") {
        if (flatten && turn.callId && unsigned.has(turn.callId))
          out.push({ role: "user", content: turn.content });
        else
          out.push({ role: "tool", tool_call_id: turn.callId, content: turn.content });
        continue;
      }
      const signed = (turn.calls ?? []).filter((call) => call.thoughtSignature);
      const replay = flatten ? signed : (turn.calls ?? []);
      if (flatten && turn.role === "assistant" && (turn.calls?.length ?? 0) && !replay.length && !turn.content?.trim())
        continue;
      out.push({
        role: turn.role,
        content: turn.content || null,
        ...(replay.length
          ? {
              tool_calls: replay.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: wireName(call.name), arguments: call.arguments },
                ...(call.thoughtSignature
                  ? { extra_content: { google: { thought_signature: call.thoughtSignature } } }
                  : {}),
              })),
            }
          : {}),
      });
    }
    return out;
  }
  private replyFromChat(value: any, toolNames: Map<string, string>, providerName: string, model: string): ModelReply {
    const choice = value?.choices?.[0];
    const message = choice?.message && typeof choice.message === "object" ? choice.message
      : choice?.delta && typeof choice.delta === "object" ? choice.delta
      : undefined;
    if (!message || typeof message !== "object")
      throw this.invalidModelResponse(providerName, model);
    if (message.tool_calls != null && !Array.isArray(message.tool_calls) && typeof message.tool_calls !== "object")
      throw this.invalidModelResponse(providerName, model);
    const content = message.content;
    const contentText = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((part: unknown) => typeof part === "string" ? part : typeof (part as any)?.text === "string" ? (part as any).text : "").join("") : "";
    return {
      text: contentText,
      calls: this.callsFromMessage(message, toolNames),
    };
  }
  private callsFromMessage(message: any, toolNames: Map<string, string>): ModelCall[] {
    const raw: any[] = [];
    if (Array.isArray(message.tool_calls)) raw.push(...message.tool_calls);
    else if (message.tool_calls && typeof message.tool_calls === "object") raw.push(...Object.values(message.tool_calls));
    if (message.function_call) raw.push({ id: message.function_call.id, function: message.function_call });
    if (message.functionCall) raw.push({
      id: message.functionCall.id,
      function: { name: message.functionCall.name, arguments: message.functionCall.args ?? message.functionCall.arguments },
    });
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        const fc = part?.functionCall ?? part?.function_call;
        if (fc) raw.push({ id: part.id, function: { name: fc.name, arguments: fc.args ?? fc.arguments } });
      }
    }
    return raw.map((call, index) => {
      const fn = call?.function ?? call;
      const name = typeof fn?.name === "string" ? (toolNames.get(fn.name) ?? fn.name) : "";
      const thoughtSignature = this.thoughtSignature(call) ?? this.thoughtSignature(fn);
      return {
        id: typeof call?.id === "string" && call.id ? call.id : "call_" + (index + 1),
        name,
        arguments: asToolArguments(fn?.arguments ?? fn?.args),
        ...(thoughtSignature ? { thoughtSignature } : {}),
      };
    }).filter((call) => call.name);
  }
  private async replyFromChatStream(
    res: Response,
    toolNames: Map<string, string>,
    onTextDelta: (delta: string) => void | Promise<void>,
    onToolCall: (() => void) | undefined,
    providerName: string,
    model: string,
  ): Promise<ModelReply> {
    let text = "";
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let sawChoice = false;
    const absorb = (part: any, indexHint = 0) => {
      if (!part || typeof part !== "object") return;
      const list = Array.isArray(part.tool_calls) ? part.tool_calls
        : part.tool_calls && typeof part.tool_calls === "object" ? Object.values(part.tool_calls)
        : part.function_call || part.functionCall ? [part] : [];
      for (const call of list) {
        const fn = call?.function ?? call.function_call ?? call.functionCall ?? call;
        const index = typeof call?.index === "number" ? call.index : indexHint;
        const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof call?.id === "string") current.id += call.id;
        if (typeof fn?.name === "string") current.name += fn.name;
        if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
        else if (fn?.arguments && typeof fn.arguments === "object") current.arguments = asToolArguments(fn.arguments);
        else if (fn?.args && typeof fn.args === "object") current.arguments = asToolArguments(fn.args);
        calls.set(index, current);
      }
    };
    await this.forEachServerEvent(res, providerName, model, async (value) => {
      const err = providerError(value);
      if (err && (err.message || err.code) && !value?.choices) throw this.providerEnvelopeError(providerName, model, err);
      const choice = value?.choices?.[0];
      if (!choice || typeof choice !== "object") {
        if (value?.error) throw this.providerEnvelopeError(providerName, model, value.error);
        return;
      }
      sawChoice = true;
      const delta = choice.delta;
      const snapshot = choice.message && typeof choice.message === "object" ? choice.message : undefined;
      const part = delta && typeof delta === "object" ? delta : snapshot;
      if (!part) return;
      if (part.tool_calls != null && !Array.isArray(part.tool_calls) && typeof part.tool_calls !== "object") throw this.invalidModelResponse(providerName, model);
      // Before the text of this same chunk: a tool turn is never streamed as an answer.
      if ((Array.isArray(part.tool_calls) && part.tool_calls.length) || part.function_call || part.functionCall) onToolCall?.();
      const pieces: string[] = [];
      if (typeof part.content === "string") pieces.push(part.content);
      else if (Array.isArray(part.content)) {
        for (const item of part.content) {
          if (typeof item === "string") pieces.push(item);
          else if (typeof item?.text === "string") pieces.push(item.text);
        }
      }
      for (const piece of pieces) {
        if (!piece) continue;
        text += piece;
        await onTextDelta(piece);
      }
      absorb(part);
    });
    if (!sawChoice) throw this.invalidModelResponse(providerName, model);
    const tool_calls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
    return this.replyFromChat({
      choices: [{ message: { content: text, ...(tool_calls.length ? { tool_calls } : {}) } }],
    }, toolNames, providerName, model);
  }
  private async replyFromResponsesStream(
    res: Response,
    toolNames: Map<string, string>,
    onTextDelta: (delta: string) => void | Promise<void>,
    onToolCall: (() => void) | undefined,
    providerName: string,
    model: string,
  ): Promise<ModelReply> {
    let completed: any;
    const held: string[] = [];
    let sawToolCall = false;
    const toolSeen = () => { sawToolCall = true; onToolCall?.(); };
    const draft = new Map<number, any>();
    const finished = new Map<number, any>();
    const sealedText = new Set<string>();
    const sealedArgs = new Set<number>();
    const appendText = (index: number, contentIndex: number, delta: string, replace = false) => {
      const key = index + ":" + contentIndex;
      if (!replace && sealedText.has(key)) return;
      let item = draft.get(index);
      if (!item || typeof item !== "object") {
        item = { type: "message", content: [] };
        draft.set(index, item);
      }
      if (!Array.isArray(item.content)) item.content = [];
      const part = item.content[contentIndex] && typeof item.content[contentIndex] === "object"
        ? item.content[contentIndex]
        : { type: "output_text", text: "" };
      part.type = part.type ?? "output_text";
      part.text = replace || typeof part.text !== "string" ? delta : part.text + delta;
      item.content[contentIndex] = part;
      if (replace) sealedText.add(key);
    };
    const ensureCall = (index: number) => {
      let item = draft.get(index);
      if (!item || typeof item !== "object") {
        item = { type: "function_call", call_id: "", name: "", arguments: "" };
        draft.set(index, item);
      }
      if (typeof item.arguments !== "string") item.arguments = "";
      return item;
    };
    await this.forEachServerEvent(res, providerName, model, async (value, eventName) => {
      const type = typeof value?.type === "string" ? value.type : eventName;
      if (type === "response.output_text.delta") {
        if (typeof value.delta !== "string" || !value.delta) return;
        // Held until the turn is known to call no tool: Responses announces a function_call only after the text.
        held.push(value.delta);
        appendText(typeof value.output_index === "number" ? value.output_index : 0, typeof value.content_index === "number" ? value.content_index : 0, value.delta);
        return;
      }
      if (type === "response.output_text.done" && typeof value.text === "string") {
        appendText(typeof value.output_index === "number" ? value.output_index : 0, typeof value.content_index === "number" ? value.content_index : 0, value.text, true);
        return;
      }
      if ((type === "response.output_item.added" || type === "response.output_item.done") && value.item && typeof value.item === "object") {
        const index = typeof value.output_index === "number" ? value.output_index : draft.size + finished.size;
        if (value.item.type === "function_call") toolSeen();
        if (type === "response.output_item.done") finished.set(index, value.item);
        else if (!draft.has(index)) draft.set(index, structuredClone(value.item));
        return;
      }
      if (type === "response.function_call_arguments.delta" && typeof value.delta === "string") {
        toolSeen();
        const index = typeof value.output_index === "number" ? value.output_index : 0;
        if (sealedArgs.has(index)) return;
        ensureCall(index).arguments += value.delta;
        return;
      }
      if (type === "response.function_call_arguments.done") {
        const index = typeof value.output_index === "number" ? value.output_index : 0;
        const item = ensureCall(index);
        if (typeof value.arguments === "string") item.arguments = value.arguments;
        if (typeof value.name === "string") item.name = value.name;
        if (typeof value.call_id === "string") item.call_id = value.call_id;
        sealedArgs.add(index);
        return;
      }
      if (type === "response.completed" || (!type && Array.isArray(value?.output))) {
        const response = type === "response.completed" && value.response && typeof value.response === "object" ? value.response : value;
        if (Array.isArray(response?.output)) completed = response;
        return;
      }
      if (type === "error" || value?.error) throw this.invalidModelResponse(providerName, model);
    });
    let reply: ModelReply;
    if (completed) reply = this.replyFromResponses(completed, toolNames, providerName, model);
    else {
      const indexes = new Set<number>([...finished.keys(), ...draft.keys()]);
      if (!indexes.size) throw this.invalidModelResponse(providerName, model);
      const output = [...indexes].sort((a, b) => a - b).map((index) => finished.get(index) ?? draft.get(index));
      reply = this.replyFromResponses({ output }, toolNames, providerName, model);
    }
    // Same rule as chat-completions: a turn that calls a tool is never streamed as an answer.
    if (!reply.calls.length && !sawToolCall) for (const piece of held) await onTextDelta(piece);
    return reply;
  }
  private async forEachServerEvent(
    res: Response,
    providerName: string,
    model: string,
    onEvent: (value: any, eventName: string) => Promise<void>,
  ): Promise<void> {
    await this.forEachSseData(res, providerName, model, async (data, eventName) => {
      let value: any;
      try { value = JSON.parse(data); }
      catch {
        throw new DiagnosticProblem("Réponse fournisseur hors contrat JSON.", {
          stage: "model.response", provider: providerName, model,
          reason: "provider_response_invalid",
        });
      }
      if (Array.isArray(value)) {
        const err = providerError(value);
        if (err) throw this.providerEnvelopeError(providerName, model, { ...err, status_code: typeof err.status === "number" ? err.status : 400 });
        throw this.invalidModelResponse(providerName, model);
      }
      if (!value || typeof value !== "object") throw this.invalidModelResponse(providerName, model);
      await onEvent(value, eventName);
    });
  }
  /** SSE: `data:` payloads, comments ignored, stop on `data: [DONE]`. */
  private async forEachSseData(
    res: Response,
    providerName: string,
    model: string,
    onData: (data: string, eventName: string) => Promise<void>,
  ): Promise<void> {
    const body = res.body;
    if (!body) {
      throw new DiagnosticProblem("Lecture de la réponse fournisseur interrompue.", {
        stage: "model.response", provider: providerName, model,
        reason: "provider_network_error",
      });
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let received = 0;
    let eventName = "";
    const interrupted = () => new DiagnosticProblem("Lecture de la réponse fournisseur interrompue.", {
      stage: "model.response", provider: providerName, model,
      reason: "provider_network_error",
    });
    const take = async (line: string) => {
      if (line.startsWith(":")) return false;
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
        return false;
      }
      if (!line.startsWith("data:")) return false;
      let data = line.slice("data:".length);
      if (data.startsWith(" ")) data = data.slice(1);
      if (data.trim() === "[DONE]") return true;
      const name = eventName;
      eventName = "";
      await onData(data, name);
      return false;
    };
    try {
      while (true) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try { next = await reader.read(); }
        catch (error) {
          if (error instanceof Problem) throw error;
          throw interrupted();
        }
        const { value, done } = next;
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > 1048576)
          throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Réponse modèle trop volumineuse.");
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (await take(line)) return;
          newline = buffer.indexOf("\n");
        }
      }
      buffer += decoder.decode();
      if (buffer.length && await take(buffer.replace(/\r$/, ""))) return;
    } finally {
      await reader.cancel().catch(() => {});
    }
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
