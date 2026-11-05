import type { Pool } from "pg";
import { approvedMcpUrl, Problem } from "./domain.js";
import { logFailure, providerReason } from "./diagnostics.js";
import type { Files } from "./files.js";
import { readModelSecret } from "./secrets.js";

export interface TranscriptionPort {
  transcribe(fileId: string, userRef: string): Promise<string>;
}

const groqEndpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
const openaiEndpoint = "https://api.openai.com/v1/audio/transcriptions";
const transcriptionDefaults: Readonly<Record<string, { endpoint: string; model: string }>> = {
  groq: { endpoint: groqEndpoint, model: "whisper-large-v3-turbo" },
  openai: { endpoint: openaiEndpoint, model: "whisper-1" },
};
const audioExtensions: Readonly<Record<string, string>> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "mp4",
  "audio/webm": "webm",
  "audio/wav": "wav",
};
const maxAudioBytes = 10485760;
const maxResponseBytes = 262144;

function hasAudioHeader(bytes: Buffer, mime: string): boolean {
  if (mime === "audio/ogg") {
    const header = bytes.subarray(0, 4096);
    return bytes.subarray(0, 4).toString("ascii") === "OggS" &&
      ["OpusHead", "\u0001vorbis", "Speex   ", "\u007fFLAC"].some((marker) => header.includes(marker));
  }
  if (mime === "audio/mpeg")
    return bytes.subarray(0, 3).toString("ascii") === "ID3" ||
      (bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mime === "audio/mp4") return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (mime === "audio/webm") return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime === "audio/wav")
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  return false;
}

export type TranscriptionOptions = {
  endpoint?: string;
  model?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  allowedEndpoints?: ReadonlySet<string>;
  /** Explicit constructor opt-in for a synthetic HTTP provider on localhost. */
  allowLocalhost?: boolean;
  /** Stored secret. When set, it is used instead of `apiKeyEnv`. */
  apiKey?: string;
};

export class HttpTranscription implements TranscriptionPort {
  private endpoint: string;
  private model: string;
  private apiKeyEnv: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(
    private files: Pick<Files, "readOwned">,
    options: TranscriptionOptions = {},
    private environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.endpoint = options.endpoint ?? groqEndpoint;
    const allowed = options.allowedEndpoints ?? new Set([groqEndpoint]);
    if (!approvedMcpUrl(this.endpoint, allowed))
      throw new Error("Transcription endpoint must be explicitly allowed.");
    const url = new URL(this.endpoint);
    if (url.search || (url.protocol !== "https:" && !options.allowLocalhost))
      throw new Error("Transcription endpoint requires HTTPS.");
    this.model = options.model ?? "whisper-large-v3-turbo";
    if (!/^[A-Za-z0-9_./-]{1,128}$/.test(this.model))
      throw new Error("Invalid transcription model configuration.");
    this.apiKeyEnv = options.apiKeyEnv ?? "GROQ_API_KEY";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.apiKeyEnv))
      throw new Error("Invalid transcription secret reference.");
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 30000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000)
      throw new Error("Transcription timeout must be between 1 and 60000 milliseconds.");
  }

  async transcribe(fileId: string, userRef: string): Promise<string> {
    const { file, bytes } = await this.files.readOwned(fileId, userRef);
    const extension = audioExtensions[file.mimeType];
    if (!extension)
      throw new Problem(415, "UNSUPPORTED_MEDIA_TYPE", "Un fichier audio est requis pour la transcription.");
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length !== file.sizeBytes)
      throw new Problem(400, "INVALID_REQUEST", "Fichier audio invalide.");
    if (bytes.length > maxAudioBytes)
      throw new Problem(413, "FILE_TOO_LARGE", "Fichier audio supérieur à 10 Mio.");
    if (!hasAudioHeader(bytes, file.mimeType))
      throw new Problem(415, "UNSUPPORTED_MEDIA_TYPE", "Le contenu ne correspond pas au format audio déclaré.");
    const apiKey = this.apiKey ?? this.environment[this.apiKeyEnv];
    if (!apiKey)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Transcription audio non configurée.");
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)], { type: file.mimeType }), "recording." + extension);
    form.set("model", this.model);
    form.set("response_format", "json");
    form.set("language", "fr");
    const context = { mimeType: file.mimeType, sizeBytes: bytes.length };
    let reason = "provider_network_error";
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: { Authorization: "Bearer " + apiKey },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const problem = new Problem(503, "UPSTREAM_UNAVAILABLE", "Le fournisseur de transcription est indisponible (HTTP " + response.status + ").");
        logFailure("transcription.failed", problem, { ...context, reason: providerReason(response.status, undefined), upstreamStatus: response.status });
        throw problem;
      }
      reason = "invalid_provider_response";
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxResponseBytes) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const text = result !== null && typeof result === "object" && "text" in result ? result.text : undefined;
      if (typeof text !== "string" || !text.trim() || text.length > 32000)
        throw new Error();
      return text.trim();
    } catch (error) {
      if (error instanceof Problem) throw error;
      const name = (error as { name?: unknown } | undefined)?.name;
      logFailure("transcription.failed", error, {
        ...context,
        reason: name === "TimeoutError" || name === "AbortError" ? "provider_network_error" : reason,
      });
      // Provider bodies, audio and transcripts may contain private data; never echo them.
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "La transcription audio a échoué ou a expiré.");
    }
  }
}

export function transcriberFromEnvironment(
  files: Files,
  environment: NodeJS.ProcessEnv = process.env,
): TranscriptionPort | undefined {
  // On by default when a key is present. No TRANSCRIPTION_ENABLED gate
  // (product decision from the user, Billux).
  const filled = (value: string | undefined) => value?.trim() ? value : undefined;
  const provider = filled(environment.MODEL_PROVIDER)?.trim().toLowerCase() ?? "groq";
  const providerDefault = Object.hasOwn(transcriptionDefaults, provider) ? transcriptionDefaults[provider] : undefined;
  const explicitEndpoint = environment.TRANSCRIPTION_ENDPOINT;
  let apiKeyEnv: string;
  let endpoint: string;
  if (environment.TRANSCRIPTION_API_KEY_ENV !== undefined) {
    apiKeyEnv = environment.TRANSCRIPTION_API_KEY_ENV;
    if (!environment[apiKeyEnv]?.trim()) return undefined;
    endpoint = explicitEndpoint ?? providerDefault?.endpoint ?? groqEndpoint;
  } else if (filled(environment.MODEL_API_KEY) && (explicitEndpoint !== undefined || providerDefault)) {
    apiKeyEnv = "MODEL_API_KEY";
    endpoint = (explicitEndpoint ?? providerDefault?.endpoint) as string;
  } else if (filled(environment.GROQ_API_KEY)) {
    apiKeyEnv = "GROQ_API_KEY";
    endpoint = explicitEndpoint ?? groqEndpoint;
  } else return undefined;
  const defaultModel = Object.values(transcriptionDefaults).find((entry) => entry.endpoint === endpoint)?.model;
  const allowedEndpoints = new Set([
    groqEndpoint,
    openaiEndpoint,
    ...(environment.TRANSCRIPTION_ALLOWED_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  ]);
  return new HttpTranscription(files, {
    endpoint,
    allowedEndpoints,
    model: environment.TRANSCRIPTION_MODEL ?? defaultModel,
    apiKeyEnv,
    timeoutMs: environment.TRANSCRIPTION_TIMEOUT_MS === undefined ? undefined : Number(environment.TRANSCRIPTION_TIMEOUT_MS),
  }, environment);
}

type ModelBody = { id?: string; baseUrl?: string; model?: string; apiKeyRef?: string; role?: string };

/** Active transcription model for one administration. Undefined leaves the env transcriber in place. */
export async function transcriberFromActiveModel(
  db: Pick<Pool, "query">,
  administrationId: string,
  files: Pick<Files, "readOwned">,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<TranscriptionPort | undefined> {
  const row = (
    await db.query(
      "SELECT body FROM backend_configurations WHERE administration_id=$1 AND resource='models' AND body->>'active'='true' AND body->>'role'='transcription' ORDER BY resource_id LIMIT 1",
      [administrationId],
    )
  ).rows[0] as { body?: ModelBody } | undefined;
  const config = row?.body;
  if (!config?.id || !config.baseUrl || !config.model || !config.apiKeyRef) return undefined;
  const endpoint = new URL("audio/transcriptions", config.baseUrl.replace(/\/?$/, "/")).href;
  const stored = await readModelSecret(db, administrationId, config.id);
  const host = new URL(endpoint).hostname;
  return new HttpTranscription(files, {
    endpoint,
    allowedEndpoints: new Set([endpoint]),
    model: config.model,
    apiKeyEnv: config.apiKeyRef,
    ...(stored ? { apiKey: stored } : {}),
    allowLocalhost: host === "localhost" || host === "127.0.0.1" || host === "[::1]",
  }, environment);
}
