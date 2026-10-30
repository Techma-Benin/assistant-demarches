// Types minimaux des contrats v1 (contracts/v1/domain.schema.json) utilisés par l’adaptateur.
// Les contrats restent la source de vérité ; la validation à l’exécution passe par ajv.

export type RequestStatus =
  | 'draft'
  | 'ready'
  | 'awaiting_user_validation'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface Source {
  procedureId: string;
  url: string;
  retrievedAt: string;
  version: string;
}

export interface ContractRequest {
  id: string;
  conversationId: string;
  userRef: string;
  procedureId: string;
  status: RequestStatus;
  fields: Record<string, string | number | boolean | null>;
  fileIds: string[];
  officialLink: string | null;
  updatedAt: string;
}

export interface ButtonItem {
  id: string;
  label: string;
}

export type FormFieldType = 'text' | 'number' | 'date';

export interface FormField {
  name: string;
  label: string;
  required: boolean;
  type: FormFieldType;
}

export type Block =
  | { type: 'text'; text: string; sources: Source[] }
  | { type: 'buttons'; items: ButtonItem[] }
  | { type: 'form'; id: string; fields: FormField[] }
  | { type: 'fileRequest'; documentType: string; label: string; acceptedMimeTypes: string[] }
  | { type: 'statusCard'; request: ContractRequest };

export interface AgentMessage {
  id: string;
  conversationId: string;
  blocks: Block[];
  createdAt: string;
}

export type Content =
  | { type: 'text'; text: string }
  | { type: 'audio' | 'image' | 'file'; fileId: string }
  | { type: 'interaction'; actionId: string; value?: string };

export interface MessageInput {
  id: string;
  content: Content;
  sentAt: string;
}

export interface ContractFile {
  id: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: 'pending' | 'clean' | 'rejected';
  expiresAt: string;
}

export interface ContractEvent {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  time: string;
  datacontenttype: 'application/json';
  traceparent: string;
  data: { kind: string; conversationId?: string; message?: AgentMessage; [key: string]: unknown };
}

export type ProblemCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FILE_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  traceId: string;
}

/** Types MIME de pièces acceptés par le contrat C1 (schéma `File.mimeType`). */
export const CONTRACT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
] as const;

export const MAX_FILE_BYTES = 10_485_760;
