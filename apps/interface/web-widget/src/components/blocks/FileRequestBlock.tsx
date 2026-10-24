import type { components } from '@techma/contracts-ts';

type Block = components['schemas']['Block'];
type Props = { block: Extract<Block, { type: 'fileRequest' }> };

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'audio/ogg': 'OGG',
  'audio/mpeg': 'MP3',
  'audio/mp4': 'M4A',
};

export function humanMimeList(mimeTypes: string[]): string {
  return mimeTypes.map((mime) => MIME_LABELS[mime] ?? mime).join(', ');
}

export function FileRequestBlock({ block }: Props) {
  return (
    <div className="space-y-2">
      <p className="font-medium">{block.label}</p>
      <p className="text-xs text-slate-600">Formats acceptés : {humanMimeList(block.acceptedMimeTypes)}</p>
      {/* TODO: envoi de pièces (POST /v1/files puis message fichier) : tâche suivante. */}
      <button
        type="button"
        disabled
        className="rounded border border-slate-400 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        Joindre une pièce
      </button>
      <p className="text-xs text-slate-500">Envoi de pièces : bientôt disponible</p>
    </div>
  );
}
