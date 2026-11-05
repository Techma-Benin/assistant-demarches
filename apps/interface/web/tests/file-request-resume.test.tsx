import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Schemas } from '@techma/contracts-ts';
import { describe, expect, it, vi } from 'vitest';
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

describe('fileRequest card stages the file in the composer', () => {
  const pdf = () => new File(['%PDF-1.4'], 'acte.pdf', { type: 'application/pdf' });
  const timeline = () => [agent(1, fileRequestBlock(), missing)];
  const open = (conversation = fakeConversation()) => {
    const state = { ...initialState, status: 'ready', conversationId: 'cnv_1', timeline: timeline() } as ConversationState;
    const rendered = render(<ConversationView conversation={{ ...conversation, state }} onRestart={() => {}} />);
    return { ...rendered, conversation };
  };
  const pick = async (container: HTMLElement) => userEvent.upload(inputs(container)[0], pdf());

  it('sends nothing on pick: the file waits in the composer and the card says so', async () => {
    const { container, conversation } = open();
    // fireEvent: user-event's click would move the focus after the change.
    fireEvent.change(inputs(container)[0], { target: { files: [pdf()] } });
    expect(conversation.sendFiles).not.toHaveBeenCalled();
    expect(screen.getByText('Prête à envoyer : acte.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/Reçue/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter cette pièce' })).toBeNull();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('sends once with the text after the file and the documentType of the line', async () => {
    const { container, conversation } = open();
    await pick(container);
    await userEvent.type(screen.getByRole('textbox'), 'Voici l’acte');
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }));
    expect(conversation.sendFiles).toHaveBeenCalledTimes(1);
    expect(conversation.sendFiles).toHaveBeenCalledWith([expect.any(File)], 'Voici l’acte', undefined, 'extrait-acte-naissance');
    expect(screen.getByText(/Reçue : acte\.pdf/)).toBeInTheDocument();
  });

  it('sends without text', async () => {
    const { container, conversation } = open();
    await pick(container);
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }));
    expect(conversation.sendFiles).toHaveBeenCalledTimes(1);
    expect(conversation.sendFiles).toHaveBeenCalledWith([expect.any(File)], undefined, undefined, 'extrait-acte-naissance');
  });

  it('goes back to normal when the file is removed from the composer', async () => {
    const { container, conversation } = open();
    await pick(container);
    await userEvent.click(screen.getByRole('button', { name: /Retirer/ }));
    expect(screen.queryByText(/Prête à envoyer/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Ajouter cette pièce' })).toBeEnabled();
    expect(conversation.sendFiles).not.toHaveBeenCalled();
  });

  it('keeps the paperclip as before: no documentType', async () => {
    const { container, conversation } = open();
    const clip = container.querySelector<HTMLInputElement>('input[type=file][aria-hidden]')!;
    await userEvent.upload(clip, pdf());
    expect(screen.queryByText(/Prête à envoyer/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }));
    expect(conversation.sendFiles).toHaveBeenCalledWith([expect.any(File)], undefined, undefined, null);
  });
});

describe('form « Continuer » with a staged file', () => {
  const pdf = () => new File(['%PDF-1.4'], 'acte.pdf', { type: 'application/pdf' });
  const form: Block = { type: 'form', id: 'identity', fields: [{ name: 'profession', label: 'Profession', required: true, type: 'text' }] };
  const open = (blocks: Block[] = [fileRequestBlock(), missing, form]) => {
    const conversation = fakeConversation();
    const state = { ...initialState, status: 'ready', conversationId: 'cnv_1', timeline: [agent(1, ...blocks)] } as ConversationState;
    const rendered = render(<ConversationView conversation={{ ...conversation, state }} onRestart={() => {}} />);
    return { ...rendered, conversation };
  };
  const stage = (container: HTMLElement) => fireEvent.change(inputs(container)[0], { target: { files: [pdf()] } });
  const submit = async () => {
    await userEvent.type(screen.getByLabelText(/Profession/), 'Comptable');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  };

  it('sends the file with the form answer as follow-up, empties the composer and marks the card received', async () => {
    const { container, conversation } = open();
    stage(container);
    expect(screen.getByText('Envoyez-la avec la flèche du message, ou avec le formulaire.')).toBeInTheDocument();
    await submit();
    expect(conversation.sendForm).not.toHaveBeenCalled();
    expect(conversation.sendFiles).toHaveBeenCalledTimes(1);
    expect(conversation.sendFiles).toHaveBeenCalledWith([expect.any(File)], undefined, undefined, 'extrait-acte-naissance', {
      content: { type: 'interaction', actionId: 'identity', value: JSON.stringify({ profession: 'Comptable' }) },
      display: 'Formulaire envoyé',
    });
    expect(screen.queryByText(/Prête à envoyer/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Retirer/ })).toBeNull();
    expect(screen.getByText(/Reçue : acte\.pdf/)).toBeInTheDocument();
  });

  it('keeps the composer text in its field', async () => {
    const { container, conversation } = open();
    stage(container);
    await userEvent.type(screen.getByPlaceholderText('Écrire un message…'), 'Brouillon');
    await submit();
    expect(vi.mocked(conversation.sendFiles).mock.calls[0][1]).toBeUndefined();
    expect(screen.getByPlaceholderText('Écrire un message…')).toHaveValue('Brouillon');
  });

  it('calls sendForm unchanged without a staged file', async () => {
    const { conversation } = open();
    await submit();
    expect(conversation.sendFiles).not.toHaveBeenCalled();
    expect(conversation.sendForm).toHaveBeenCalledWith('identity', { profession: 'Comptable' }, 'Formulaire envoyé');
  });

  it('hints at the message arrow only when no form is active', () => {
    const { container } = open([fileRequestBlock(), missing]);
    stage(container);
    expect(screen.getByText('Envoyez-la avec la flèche du message.')).toBeInTheDocument();
  });
});
