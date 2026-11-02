export const CONTRACT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
] as const;
export type ContractMimeType = (typeof CONTRACT_MIME_TYPES)[number];

// 10 Mio (contract: POST /v1/files).
export const MAX_FILE_BYTES = 10485760;

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'audio/ogg': 'OGG',
  'audio/mpeg': 'MP3',
  'audio/mp4': 'M4A',
};

export const mimeLabel = (mime: string): string => MIME_LABELS[mime] ?? mime;
export const mimeLabels = (mimeTypes: readonly string[]): string => mimeTypes.map(mimeLabel).join(', ');

export function effectiveMimeTypes(accepted: readonly string[]): ContractMimeType[] {
  return CONTRACT_MIME_TYPES.filter((mime) => accepted.includes(mime));
}

export function validateFile(
  file: { size: number; type: string },
  accepted: readonly string[],
): { ok: true; mimeType: ContractMimeType } | { ok: false; error: string } {
  if (file.size === 0) return { ok: false, error: 'Le fichier est vide.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'Fichier trop volumineux (10 Mo maximum).' };
  const allowed = effectiveMimeTypes(accepted);
  const mimeType = allowed.find((mime) => mime === file.type);
  if (!mimeType) return { ok: false, error: `Format non accepté. Formats acceptés : ${mimeLabels(allowed)}.` };
  return { ok: true, mimeType };
}

export function contentTypeFor(mime: string): 'image' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

const sizeFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${sizeFormat.format(bytes)} o`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} Ko`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} Mo`;
}
