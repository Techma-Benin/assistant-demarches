import type { Schemas } from '@techma/contracts-ts';
import examples from '../../../../contracts/v2/examples.json';

// Shapes come from contracts/v2/examples.json (validated against the contract); tests only vary ids and texts.
export const CONVERSATION_ID = 'cnv_01JD0000000000000000000001';

export type Case = Schemas['Case'];
export type Request = Schemas['Request'];
export type Block = Schemas['Block'];
export type AgentMessage = Schemas['AgentMessage'];
export type ContractEvent = Schemas['Event'];

export const exampleCase = examples.schemas.Case as unknown as Case;
export const exampleRequest = examples.schemas.Request as unknown as Request;
export const exampleAgentMessage = examples.schemas.AgentMessage as unknown as AgentMessage;
export const exampleReceived = examples.events[0] as unknown as ContractEvent;

const ULID_TAIL = (n: number) => String(n).padStart(25, '0');
export const evtId = (n: number) => `evt_0${ULID_TAIL(n)}`;
export const msgId = (n: number) => `msg_0${ULID_TAIL(n)}`;
export const docId = (n: number) => `doc_0${ULID_TAIL(n)}`;
export const chlId = (n: number) => `chl_0${ULID_TAIL(n)}`;

export function agentEvent(n: number, blocks: Block[], conversationId = CONVERSATION_ID): ContractEvent {
  return {
    specversion: '1.0',
    id: evtId(n),
    source: 'urn:techma:backend',
    type: 'bj.techma.message.sent.v2',
    time: `2026-11-02T09:00:${String(10 + (n % 50)).padStart(2, '0')}Z`,
    datacontenttype: 'application/json',
    data: {
      kind: 'message.sent',
      conversationId,
      message: { id: msgId(n), conversationId, blocks, createdAt: `2026-11-02T09:00:${String(10 + (n % 50)).padStart(2, '0')}Z` },
    },
  } as ContractEvent;
}

export function userEvent(
  n: number,
  content: Schemas['Content'],
  options: { transcript?: string | null; messageId?: string; conversationId?: string } = {},
): ContractEvent {
  const conversationId = options.conversationId ?? CONVERSATION_ID;
  return {
    specversion: '1.0',
    id: evtId(n),
    source: 'urn:techma:backend',
    type: 'bj.techma.message.received.v2',
    time: `2026-11-02T08:59:${String(10 + (n % 50)).padStart(2, '0')}Z`,
    datacontenttype: 'application/json',
    data: {
      kind: 'message.received',
      conversationId,
      message: {
        id: options.messageId ?? msgId(n),
        content,
        transcript: options.transcript ?? null,
        sentAt: `2026-11-02T08:59:${String(10 + (n % 50)).padStart(2, '0')}Z`,
      },
    },
  } as ContractEvent;
}

export const textBlock = (text: string, sources: Schemas['Source'][] = []): Block => ({ type: 'text', text, sources });
export const exampleSource = (exampleAgentMessage.blocks[0] as Extract<Block, { type: 'text' }>).sources[0];

export const consentBlock = (id = chlId(1), expiresAt = '2099-01-01T00:00:00Z'): Block => ({
  type: 'consent',
  challenge: {
    id,
    conversationId: CONVERSATION_ID,
    userRef: 'usr_01JD0000000000000000000001',
    procedureId: 'PS00373',
    scopes: ['requests:write', 'documents:write'],
    consentText: 'J’autorise l’assistant à préparer ma demande de casier judiciaire.',
    expiresAt,
    proofToken: 'proof.jwt.token',
  },
});

export const fileRequestBlock = (received = false): Block => ({
  type: 'fileRequest',
  requestId: exampleRequest.id,
  documentType: 'extrait-acte-naissance',
  label: 'Extrait d’acte de naissance',
  acceptedMimeTypes: ['application/pdf', 'image/jpeg'],
  received,
});

export const requestCardBlock = (request: Request = exampleRequest): Block => ({ type: 'requestCard', request });
export const caseCardBlock = (item: Case = exampleCase): Block => ({ type: 'caseCard', case: item });
export const loginRequiredBlock: Block = { type: 'loginRequired', reason: 'Connectez-vous pour déposer ce dossier.' };

export function issuedCase(overrides: Partial<Case> = {}): Case {
  return {
    ...exampleCase,
    status: 'completed',
    documents: [
      ...exampleCase.documents,
      {
        id: docId(2) as Case['documents'][number]['id'],
        kind: 'issued',
        documentType: 'casier-judiciaire',
        name: 'Extrait B3 du casier judiciaire',
        mimeType: 'application/pdf',
        sizeBytes: 20000,
        createdAt: '2026-11-02T10:00:00Z',
      },
    ],
    ...overrides,
  };
}
