export interface WaMedia {
  id: string;
  mime_type?: string;
  filename?: string;
}

export interface WaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
  image?: WaMedia;
  document?: WaMedia;
  audio?: WaMedia;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Extrait les messages entrants ; les `statuses` et champs inconnus sont ignorés. */
export function extractMessages(payload: unknown): WaMessage[] {
  if (!isObject(payload) || payload['object'] !== 'whatsapp_business_account' || !Array.isArray(payload['entry'])) return [];
  const out: WaMessage[] = [];
  for (const entry of payload['entry']) {
    if (!isObject(entry) || !Array.isArray(entry['changes'])) continue;
    for (const change of entry['changes']) {
      if (!isObject(change) || change['field'] !== 'messages' || !isObject(change['value'])) continue;
      const messages = change['value']['messages'];
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        if (isObject(m) && typeof m['from'] === 'string' && typeof m['id'] === 'string' && typeof m['type'] === 'string') {
          out.push(m as unknown as WaMessage);
        }
      }
    }
  }
  return out;
}
