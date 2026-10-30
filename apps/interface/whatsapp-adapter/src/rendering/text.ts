import type { Source } from '../contracts/types.js';
import type { OutboundMessage } from './types.js';

export const TEXT_MAX = 4096;

export const textMessage = (body: string): OutboundMessage => ({ type: 'text', text: { body, preview_url: false } });

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** JJ/MM/AAAA en UTC. */
export function formatDateFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function sourceLine(source: Source): string {
  const date = formatDateFr(source.retrievedAt);
  if (isHttpUrl(source.url)) {
    const host = new URL(source.url).hostname;
    return `• ${host} - version ${source.version}, consultée le ${date} : ${source.url}`;
  }
  // URL non http(s) (ex. javascript:) : jamais affichée.
  return `• ${source.procedureId} - version ${source.version}, consultée le ${date}`;
}

/** Texte du bloc, suivi du paragraphe « Sources : » s’il y en a. */
export function renderTextBlock(text: string, sources: Source[]): string {
  if (sources.length === 0) return text;
  return `${text}\n\nSources :\n${sources.map(sourceLine).join('\n')}`;
}

function hardSplit(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Coupe en morceaux ≤ max, de préférence entre paragraphes, puis entre lignes, puis entre mots. */
export function splitText(body: string, max = TEXT_MAX): string[] {
  if (body.length <= max) return [body];
  const chunks: string[] = [];
  let current = '';
  const push = (piece: string, separator: string) => {
    if (current === '') {
      current = piece;
    } else if (current.length + separator.length + piece.length <= max) {
      current += separator + piece;
    } else {
      chunks.push(current);
      current = piece;
    }
  };
  for (const paragraph of body.split('\n\n')) {
    if (paragraph.length <= max) {
      push(paragraph, '\n\n');
      continue;
    }
    for (const line of paragraph.split('\n')) {
      if (line.length <= max) {
        push(line, '\n');
        continue;
      }
      for (const piece of hardSplit(line, max)) {
        push(piece, '\n');
      }
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}
