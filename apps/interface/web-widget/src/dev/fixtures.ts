import type { components } from '@techma/contracts-ts';

type AgentMessage = components['schemas']['AgentMessage'];

const pad = (n: number) => String(n).padStart(26, '0');
const CONVERSATION_ID = `cnv_${pad(1)}`;
const CREATED_AT = '2026-10-22T18:00:00Z';

const message = (n: number, blocks: AgentMessage['blocks']): AgentMessage => ({
  id: `msg_${pad(n)}`,
  conversationId: CONVERSATION_ID,
  blocks,
  createdAt: CREATED_AT,
});

const source = {
  procedureId: 'demo-procedure',
  url: 'https://example.org/demonstration',
  retrievedAt: CREATED_AT,
  version: 'demo-1',
};

export const fixtures: AgentMessage[] = [
  message(1, [
    {
      type: 'text',
      text: 'Cette démarche fictive demande un formulaire et une pièce.\nContenu de démonstration, sans valeur administrative.',
      sources: [source],
    },
  ]),
  message(2, [
    { type: 'text', text: 'Bonjour ! Je suis l’assistant de simulation. Comment puis-je vous aider ?', sources: [] },
  ]),
  message(3, [
    {
      type: 'buttons',
      items: [
        { id: 'start-demo', label: 'Démarrer' },
        { id: 'more-info', label: 'En savoir plus' },
        { id: 'cancel', label: 'Annuler' },
      ],
    },
  ]),
  message(4, [
    {
      type: 'form',
      id: 'demo-identity-form',
      fields: [
        { name: 'displayName', label: 'Nom affiché (fictif)', required: true, type: 'text' },
        { name: 'householdSize', label: 'Nombre de personnes', required: true, type: 'number' },
        { name: 'startDate', label: 'Date de début', required: false, type: 'date' },
      ],
    },
  ]),
  message(5, [
    {
      type: 'fileRequest',
      documentType: 'demo-document',
      label: 'Pièce justificative (démarche fictive)',
      acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    },
  ]),
  message(6, [
    {
      type: 'statusCard',
      request: {
        id: `req_${pad(1)}`,
        conversationId: CONVERSATION_ID,
        userRef: `usr_${pad(1)}`,
        procedureId: 'demo-procedure',
        status: 'awaiting_user_validation',
        fields: {},
        fileIds: [`fil_${pad(1)}`],
        officialLink: 'https://example.org/demonstration',
        updatedAt: CREATED_AT,
      },
    },
  ]),
  message(7, [
    {
      type: 'statusCard',
      request: {
        id: `req_${pad(2)}`,
        conversationId: CONVERSATION_ID,
        userRef: `usr_${pad(1)}`,
        procedureId: 'demo-procedure',
        status: 'draft',
        fields: {},
        fileIds: [],
        officialLink: null,
        updatedAt: CREATED_AT,
      },
    },
  ]),
];
