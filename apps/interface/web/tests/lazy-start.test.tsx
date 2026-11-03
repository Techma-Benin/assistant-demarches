import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConversation } from '@/hooks/use-conversation';
import { C1Error, type C1Client } from '@/lib/c1-client';
import { CONVERSATION_ID as CNV } from './fixtures-v2';

function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  return {
    createConversation: vi.fn(async () => ({ id: CNV })),
    createSocketTicket: vi.fn(async () => {
      throw new Error('no socket');
    }),
    listEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    uploadFile: vi.fn(async (_blob: Blob, mime: string) => ({ id: 'fil_' + '0'.repeat(25) + '1', mimeType: mime })),
    sendMessage: vi.fn(async (_id: string, input: { id: string }) => ({ messageId: input.id, status: 'accepted' })),
    ...over,
  };
}
const make = (client: ReturnType<typeof fakeClient>) => renderHook(() => useConversation(client as unknown as C1Client));
const sent = (client: ReturnType<typeof fakeClient>) =>
  (client.sendMessage.mock.calls as unknown as [string, { id: string; content: unknown }][]).map((call) => call[1].content);

describe('lazy conversation start', () => {
  it('does nothing on mount: no conversation, no stream', async () => {
    const client = fakeClient();
    const { result } = make(client);
    await act(async () => {});
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.conversationId).toBeNull();
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.createSocketTicket).not.toHaveBeenCalled();
    expect(client.listEvents).not.toHaveBeenCalled();
  });

  it('creates the conversation with the first message, with the locale only, then sends it', async () => {
    const client = fakeClient();
    const { result } = make(client);
    act(() => result.current.sendText('  Bonjour  '));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(1));
    expect(client.createConversation).toHaveBeenCalledTimes(1);
    expect(client.createConversation.mock.calls[0]).toEqual([{ locale: 'fr' }, expect.any(String)]);
    expect(client.sendMessage.mock.calls[0]).toMatchObject([CNV, { content: { type: 'text', text: 'Bonjour' } }]);
    expect(result.current.state).toMatchObject({ status: 'ready', conversationId: CNV });
  });

  it('several sends in a row share one creation (one guest session)', async () => {
    const client = fakeClient();
    const { result } = make(client);
    act(() => {
      result.current.sendText('Un');
      result.current.sendText('Deux');
      result.current.sendButton({ id: 'go', label: 'Aller' });
    });
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(3));
    expect(client.createConversation).toHaveBeenCalledTimes(1);
  });

  it('creates the conversation before the first upload: one call at a time', async () => {
    const order: string[] = [];
    const client = fakeClient({
      createConversation: vi.fn(async () => {
        order.push('create');
        return { id: CNV };
      }),
      uploadFile: vi.fn(async (_b: Blob, mime: string) => {
        order.push('upload');
        return { id: 'fil_' + '0'.repeat(25) + '1', mimeType: mime };
      }),
    });
    const { result } = make(client);
    act(() => result.current.sendFiles([new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' }), new File(['%PDF-1.4'], 'b.pdf', { type: 'application/pdf' })]));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(order).toEqual(['create', 'upload', 'upload']);
  });

  it('a failed creation marks the message failed, and retry tries to create again', async () => {
    const createConversation = vi.fn().mockRejectedValueOnce(new C1Error(503)).mockResolvedValue({ id: CNV });
    const client = fakeClient({ createConversation });
    const { result } = make(client);
    act(() => result.current.sendText('Bonjour'));
    await waitFor(() => expect(result.current.state.timeline[0]).toMatchObject({ delivery: 'failed' }));
    expect(result.current.state.status).toBe('idle');
    expect(client.sendMessage).not.toHaveBeenCalled();
    act(() => result.current.retry((result.current.state.timeline[0] as { id: string }).id));
    await waitFor(() => expect(result.current.state.timeline[0]).toMatchObject({ delivery: 'accepted' }));
    expect(createConversation).toHaveBeenCalledTimes(2);
  });
});

describe('outgoing payloads (v2 Content)', () => {
  const ready = async () => {
    const client = fakeClient();
    const hook = make(client);
    act(() => hook.result.current.sendText('Salut'));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(1));
    return { client, ...hook };
  };

  it('text', async () => {
    const { client } = await ready();
    expect(sent(client)[0]).toEqual({ type: 'text', text: 'Salut' });
  });

  it('button: interaction with value null', async () => {
    const { client, result } = await ready();
    act(() => result.current.sendButton({ id: 'prepare', label: 'Préparer ma demande' }));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(sent(client)[1]).toEqual({ type: 'interaction', actionId: 'prepare', value: null });
  });

  it('form: interaction with the form id and the answers as JSON in value', async () => {
    const { client, result } = await ready();
    act(() => result.current.sendForm('identity', { profession: 'Comptable' }, 'Formulaire envoyé'));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(sent(client)[1]).toEqual({ type: 'interaction', actionId: 'identity', value: '{"profession":"Comptable"}' });
  });

  it('a file that answers a fileRequest carries its documentType', async () => {
    const { client, result } = await ready();
    act(() => result.current.sendFiles([new File(['%PDF-1.4'], 'acte.pdf', { type: 'application/pdf' })], undefined, undefined, 'extrait-acte-naissance'));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(sent(client)[1]).toEqual({ type: 'file', fileId: 'fil_' + '0'.repeat(25) + '1', documentType: 'extrait-acte-naissance' });
  });

  it('a free file has documentType null; an image is a file, never `image`', async () => {
    const { client, result } = await ready();
    act(() => result.current.sendFiles([new File(['x'], 'cni.png', { type: 'image/png' })]));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(sent(client)[1]).toEqual({ type: 'file', fileId: 'fil_' + '0'.repeat(25) + '1', documentType: null });
  });

  it('a voice message is audio {fileId}, webm accepted, whatever documentType is passed', async () => {
    const { client, result } = await ready();
    act(() =>
      result.current.sendFiles([new File(['x'], 'Message vocal.webm', { type: 'audio/webm' })], undefined, { durationMs: 3000, waveform: [] }, 'ignored'),
    );
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(client.uploadFile.mock.calls[0][1]).toBe('audio/webm');
    expect(sent(client)[1]).toEqual({ type: 'audio', fileId: 'fil_' + '0'.repeat(25) + '1' });
  });
});
