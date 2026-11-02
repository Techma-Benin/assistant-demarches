import { DiagnosticProblem, providerReason, safeProviderIdentifier } from "./diagnostics.js";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
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
    options?: { onTextDelta?: (delta: string) => void | Promise<void> },
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
    options?: { onTextDelta?: (delta: string) => void | Promise<void> },
  ): Promise<ModelReply> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.generateOnce(config, history, tools, options); }
      catch (error) {
        const diagnostic = error instanceof DiagnosticProblem ? error.diagnostic : undefined;
        const status = diagnostic?.upstreamStatus;
        const transient = diagnostic?.reason === "provider_network_error" || diagnostic?.reason === "provider_response_invalid" || (typeof status === "number" && ([408, 425, 429].includes(status) || status >= 500));
        if (!transient || attempt >= 2) throw error;
        // Only provider generation is retried; tool actions are handled by Agent.
        await delay(250 * 2 ** attempt);
      }
    }
  }
  private async generateOnce(
    config: ModelConfig,
    history: Turn[],
    tools: ToolDefinition[],
    options?: { onTextDelta?: (delta: string) => void | Promise<void> },
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
      omitTemperature: extras?.omitTemperature,
      parallelToolCalls: extras?.parallelToolCalls,
    };
    const providerName = new URL(config.baseUrl).host;
    const prompt = readFileSync(
      new URL("./assets/prompts/agent-v1.txt", import.meta.url),
      "utf8",
    );
    const apiKey = this.environment[config.apiKeyRef];
    if (!apiKey)
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
    // Groq and several OpenAI-compatible services reject an empty tools array.
    if (!tools.length) delete body.tools;
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
      throw new DiagnosticProblem("Appel au fournisseur IA refusé (HTTP " + res.status + ").", {
        stage: "model.response", provider: providerName, model: config.model,
        upstreamStatus: res.status,
        upstreamCode: safeProviderIdentifier(upstream?.error?.code),
        upstreamType: safeProviderIdentifier(upstream?.error?.type),
        upstreamRequestId: safeProviderIdentifier(res.headers.get("x-request-id") ?? res.headers.get("request-id")),
        reason: res.status === 400 && new URL(provider.baseUrl).hostname === "api.groq.com" && upstream?.error?.code === "tool_use_failed"
          ? "provider_tool_generation_invalid"
          : providerReason(res.status, upstream?.error?.message),
      });
    }
    if (onTextDelta) {
      return responses
        ? await this.replyFromResponsesStream(res, toolNames, onTextDelta, providerName, config.model)
        : await this.replyFromChatStream(res, toolNames, onTextDelta, providerName, config.model);
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
  private replyFromChat(value: any, toolNames: Map<string, string>, providerName: string, model: string): ModelReply {
    const message = value?.choices?.[0]?.message;
    if (!message || typeof message !== "object" || (message.tool_calls != null && !Array.isArray(message.tool_calls)))
      throw this.invalidModelResponse(providerName, model);
    const content = message.content;
    const contentText = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((part: unknown) => typeof part === "string" ? part : typeof (part as any)?.text === "string" ? (part as any).text : "").join("") : "";
    return {
      text: contentText,
      calls: (message.tool_calls ?? []).map((call: any) => ({
        id: call.id,
        name: toolNames.get(call.function?.name) ?? call.function?.name,
        arguments: call.function?.arguments,
      })),
    };
  }
  private async replyFromChatStream(
    res: Response,
    toolNames: Map<string, string>,
    onTextDelta: (delta: string) => void | Promise<void>,
    providerName: string,
    model: string,
  ): Promise<ModelReply> {
    let text = "";
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let sawChoice = false;
    await this.forEachServerEvent(res, providerName, model, async (value) => {
      const choice = value?.choices?.[0];
      if (!choice || typeof choice !== "object") {
        if (value?.error) throw this.invalidModelResponse(providerName, model);
        return;
      }
      sawChoice = true;
      const delta = choice.delta;
      if (!delta || typeof delta !== "object") return;
      const pieces: string[] = [];
      if (typeof delta.content === "string") pieces.push(delta.content);
      else if (Array.isArray(delta.content)) {
        for (const part of delta.content) {
          if (typeof part === "string") pieces.push(part);
          else if (typeof part?.text === "string") pieces.push(part.text);
        }
      }
      for (const piece of pieces) {
        if (!piece) continue;
        text += piece;
        await onTextDelta(piece);
      }
      if (delta.tool_calls != null && !Array.isArray(delta.tool_calls)) throw this.invalidModelResponse(providerName, model);
      for (const call of delta.tool_calls ?? []) {
        const index = typeof call?.index === "number" ? call.index : 0;
        const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof call?.id === "string") current.id += call.id;
        if (typeof call?.function?.name === "string") current.name += call.function.name;
        if (typeof call?.function?.arguments === "string") current.arguments += call.function.arguments;
        calls.set(index, current);
      }
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
    providerName: string,
    model: string,
  ): Promise<ModelReply> {
    let completed: any;
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
        await onTextDelta(value.delta);
        appendText(typeof value.output_index === "number" ? value.output_index : 0, typeof value.content_index === "number" ? value.content_index : 0, value.delta);
        return;
      }
      if (type === "response.output_text.done" && typeof value.text === "string") {
        appendText(typeof value.output_index === "number" ? value.output_index : 0, typeof value.content_index === "number" ? value.content_index : 0, value.text, true);
        return;
      }
      if ((type === "response.output_item.added" || type === "response.output_item.done") && value.item && typeof value.item === "object") {
        const index = typeof value.output_index === "number" ? value.output_index : draft.size + finished.size;
        if (type === "response.output_item.done") finished.set(index, value.item);
        else if (!draft.has(index)) draft.set(index, structuredClone(value.item));
        return;
      }
      if (type === "response.function_call_arguments.delta" && typeof value.delta === "string") {
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
    if (completed) return this.replyFromResponses(completed, toolNames, providerName, model);
    const indexes = new Set<number>([...finished.keys(), ...draft.keys()]);
    if (!indexes.size) throw this.invalidModelResponse(providerName, model);
    const output = [...indexes].sort((a, b) => a - b).map((index) => finished.get(index) ?? draft.get(index));
    return this.replyFromResponses({ output }, toolNames, providerName, model);
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
      if (!value || typeof value !== "object" || Array.isArray(value)) throw this.invalidModelResponse(providerName, model);
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
