import { approvedMcpUrl, Problem } from "./domain.js";
import type { Files } from "./files.js";

export interface TranscriptionPort {
  transcribe(fileId: string, userRef: string): Promise<string>;
}

const groqEndpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
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
};

export class HttpTranscription implements TranscriptionPort {
  private endpoint: string;
  private model: string;
  private apiKeyEnv: string;
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
    const apiKey = this.environment[this.apiKeyEnv];
    if (!apiKey)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Transcription audio non configurée.");
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)], { type: file.mimeType }), "recording." + extension);
    form.set("model", this.model);
    form.set("response_format", "json");
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
        throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Le fournisseur de transcription est indisponible (HTTP " + response.status + ").");
      }
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
      // Provider bodies, audio and transcripts may contain private data; never echo them.
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "La transcription audio a échoué ou a expiré.");
    }
  }
}

export function transcriberFromEnvironment(
  files: Files,
  environment: NodeJS.ProcessEnv = process.env,
): TranscriptionPort | undefined {
  if (environment.TRANSCRIPTION_ENABLED !== "true") return undefined;
  const endpoint = environment.TRANSCRIPTION_ENDPOINT ?? groqEndpoint;
  const allowedEndpoints = new Set([
    groqEndpoint,
    ...(environment.TRANSCRIPTION_ALLOWED_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  ]);
  return new HttpTranscription(files, {
    endpoint,
    allowedEndpoints,
    model: environment.TRANSCRIPTION_MODEL,
    apiKeyEnv: environment.TRANSCRIPTION_API_KEY_ENV ?? "GROQ_API_KEY",
    timeoutMs: environment.TRANSCRIPTION_TIMEOUT_MS === undefined ? undefined : Number(environment.TRANSCRIPTION_TIMEOUT_MS),
  }, environment);
}
