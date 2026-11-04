import { render, screen } from '@testing-library/react';
import type { Schemas } from '@techma/contracts-ts';
import { describe, expect, it } from 'vitest';
import { ConversationView } from '@/components/chat/ConversationView';
import { initialState, type ConversationState, type TimelineEntry } from '@/lib/conversation-state';
import { fakeConversation } from './conversation-helper';
import { exampleRequest, fileRequestBlock, msgId, requestCardBlock } from './fixtures-v2';

type Block = Schemas['Block'];

const at = '2026-11-02T18:00:00Z';
const agent = (n: number, ...blocks: Block[]): TimelineEntry => ({
  kind: 'agent',
  message: { id: msgId(n), conversationId: 'cnv_1', blocks, createdAt: at } as never,
});
const text = (t: string): Block => ({ type: 'text', text: t, sources: [] });
const missing = requestCardBlock({ ...exampleRequest, status: 'draft', documents: [{ ...exampleRequest.documents[0], fileId: null }] });
const given = requestCardBlock({ ...exampleRequest, status: 'ready' });

const view = (timeline: TimelineEntry[]) =>
  render(
    <ConversationView
      conversation={fakeConversation({ state: { ...initialState, status: 'ready', conversationId: 'cnv_1', timeline } as ConversationState })}
      onRestart={() => {}}
    />,
  );
const inputs = (container: HTMLElement) => [...container.querySelectorAll<HTMLInputElement>('input[type=file][id]')].filter((i) => i.closest('[data-document-type]'));

describe('fileRequest after a newer agent message', () => {
  it('stays enabled while the document is still missing', () => {
    const { container } = view([agent(1, fileRequestBlock(), missing), agent(2, text('Autre chose ?'))]);
    const [input] = inputs(container);
    expect(input).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Ajouter cette pièce' })).toBeEnabled();
  });

  it('shows as received once a newer request card has the file', () => {
    view([agent(1, fileRequestBlock(), missing), agent(2, text('Merci'), given)]);
    expect(screen.getByText('Pièce reçue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter cette pièce' })).toBeNull();
  });

  it('keeps only the most recent block of a key active', () => {
    const { container } = view([agent(1, fileRequestBlock(), missing), agent(2, text('Relance'), fileRequestBlock()), agent(3, text('Suite'))]);
    const [older, newer] = inputs(container);
    expect(older).toBeDisabled();
    expect(newer).toBeEnabled();
  });

  it('stays disabled without a draft that is missing the document', () => {
    const { container } = view([agent(1, fileRequestBlock()), agent(2, text('Suite'))]);
    expect(inputs(container)[0]).toBeDisabled();
  });
});
