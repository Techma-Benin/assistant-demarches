import { CONTRACT_MIME_TYPES, type AgentMessage, type Block, type ContractRequest, type RequestStatus } from '../contracts/types.js';
import { sha256Hex } from '../common/crypto.js';
import { questionMessage, startFormSession } from './form-session.js';
import { formatDateFr, isHttpUrl, renderTextBlock, splitText, textMessage } from './text.js';
import type { FormSession, OutboundMessage, RenderContext, RenderResult } from './types.js';

const INTERACTIVE_BODY_MAX = 1024;
const REPLY_ID_MAX = 256;
const DEFAULT_BUTTON_BODY = 'Choisissez une option :';

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Brouillon',
  ready: 'Prête',
  awaiting_user_validation: 'À valider sur le portail officiel',
  submitted: 'Déposée',
  processing: 'En traitement',
  completed: 'Terminée',
  rejected: 'Rejetée',
  cancelled: 'Annulée',
};

const FORMAT_LABELS: [label: string, mimes: string[]][] = [
  ['PDF', ['application/pdf']],
  ['photo JPEG', ['image/jpeg']],
  ['photo PNG', ['image/png']],
  ['message vocal', ['audio/ogg', 'audio/mpeg', 'audio/mp4']],
];

function formatsFor(accepted: string[]): string {
  const allowed = accepted.filter((m) => (CONTRACT_MIME_TYPES as readonly string[]).includes(m));
  const pool = allowed.length > 0 ? allowed : [...CONTRACT_MIME_TYPES];
  return FORMAT_LABELS.filter(([, mimes]) => mimes.some((m) => pool.includes(m)))
    .map(([label]) => label)
    .join(', ');
}

function statusCardText(request: ContractRequest): string {
  let text = `Votre demande : ${STATUS_LABELS[request.status]}\nDémarche : ${request.procedureId}\nMise à jour le ${formatDateFr(request.updatedAt)}`;
  if (request.officialLink && isHttpUrl(request.officialLink)) text += `\nPortail officiel : ${request.officialLink}`;
  return text;
}

/** Corps complet d’un bloc texte à fusionner dans un message interactif, ou undefined. */
function mergeableBody(blocks: Block[], index: number): string | undefined {
  const block = blocks[index];
  if (block?.type !== 'text') return undefined;
  const body = renderTextBlock(block.text, block.sources);
  return body.length <= INTERACTIVE_BODY_MAX ? body : undefined;
}

function assertNever(value: never): never {
  throw new Error(`Type de bloc non géré : ${JSON.stringify(value)}`);
}

/** Rendu pur et déterministe d’un message agent vers des messages WhatsApp. */
export function renderAgentMessage(message: AgentMessage, ctx: RenderContext): RenderResult {
  const messages: OutboundMessage[] = [];
  const buttonIds: Record<string, string> = {};
  let formSession: FormSession | undefined;
  const { blocks } = message;

  blocks.forEach((block, index) => {
    switch (block.type) {
      case 'text': {
        // Fusionné dans le message à boutons qui suit.
        if (blocks[index + 1]?.type === 'buttons' && mergeableBody(blocks, index) !== undefined) return;
        for (const part of splitText(renderTextBlock(block.text, block.sources))) messages.push(textMessage(part));
        return;
      }
      case 'buttons': {
        const body = mergeableBody(blocks, index - 1) ?? DEFAULT_BUTTON_BODY;
        const buttons = block.items.map((item) => {
          let id = item.id;
          if (id.length > REPLY_ID_MAX) {
            id = `b_${sha256Hex(item.id).slice(0, 12)}`;
            buttonIds[id] = item.id;
          }
          return { type: 'reply' as const, reply: { id, title: item.label } };
        });
        messages.push({ type: 'interactive', interactive: { type: 'button', body: { text: body }, action: { buttons } } });
        return;
      }
      case 'form': {
        const first = block.fields[0];
        if (!first) return;
        formSession = startFormSession(block.id, block.fields, ctx.now);
        messages.push(questionMessage(first));
        return;
      }
      case 'fileRequest': {
        messages.push(
          textMessage(
            `${block.label}\nEnvoyez la pièce dans cette conversation : ${formatsFor(block.acceptedMimeTypes)}, 10 Mo maximum.`,
          ),
        );
        return;
      }
      case 'statusCard': {
        messages.push(textMessage(statusCardText(block.request)));
        return;
      }
      default:
        return assertNever(block);
    }
  });

  return {
    messages,
    ...(formSession ? { formSession } : {}),
    ...(Object.keys(buttonIds).length > 0 ? { buttonIds } : {}),
  };
}
