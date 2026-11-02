import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConversation } from '@/hooks/use-conversation';
import type { C1Client } from '@/lib/c1-client';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const pdf = () => new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });

function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  return {
    createConversation: vi.fn(async () => ({ id: CNV })),
    createSocketTicket: vi.fn(async () => {
      throw new Error('no socket');
    }),
    listEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    uploadFile: vi.fn(async () => ({ id: 'fil_1', mimeType: 'application/pdf' })),
    sendMessage: vi.fn(async () => ({})),
    ...over,
  };
}

async function setup(client: ReturnType<typeof fakeClient>) {
  const hook = renderHook(() => useConversation(client as unknown as C1Client));
  await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
  return hook;
}

const contents = (client: ReturnType<typeof fakeClient>) =>
  (client.sendMessage.mock.calls as unknown as [string, { id: string; content: unknown }][]).map((c) => c[1]);

describe('sendFile with a note', () => {
  it('shows file then note, posts the note only after the file is accepted', async () => {
    let release!: () => void;
    const client = fakeClient({
      sendMessage: vi.fn(
        (_cnv: string, input: { content: { type: string } }) =>
          input.content.type === 'text' ? Promise.resolve({}) : new Promise((resolve) => (release = () => resolve({}))),
      ),
    });
    const { result } = await setup(client);
    act(() => result.current.sendFile(pdf(), '  Voici ma pièce  '));
    const [fileEntry, noteEntry] = result.current.state.timeline as Extract<
      (typeof result.current.state.timeline)[number],
      { kind: 'user' }
    >[];
    expect(fileEntry).toMatchObject({ kind: 'user', attachment: { name: 'doc.pdf' } });
    expect(noteEntry).toMatchObject({ kind: 'user', display: 'Voici ma pièce' });

    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(1));
    expect(contents(client)[0].content).toEqual({ type: 'file', fileId: 'fil_1' });
    act(() => release());
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(contents(client)[1]).toMatchObject({ id: noteEntry.id, content: { type: 'text', text: 'Voici ma pièce' } });
  });

  it('keeps the note waiting while the upload fails and posts it after a successful retry', async () => {
    const client = fakeClient({
      uploadFile: vi
        .fn()
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValue({ id: 'fil_1', mimeType: 'application/pdf' }),
    });
    const { result } = await setup(client);
    act(() => result.current.sendFile(pdf(), 'note'));
    await waitFor(() => expect(result.current.state.timeline[0]).toMatchObject({ delivery: 'uploadFailed' }));
    expect(client.sendMessage).not.toHaveBeenCalled();

    act(() => result.current.retry((result.current.state.timeline[0] as { id: string }).id));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    expect(contents(client)[1].content).toEqual({ type: 'text', text: 'note' });
    const keys = (client.uploadFile.mock.calls as unknown as string[][]).map((c) => c[2]);
    expect(keys[0]).toBe(keys[1]);
  });

  it('posts nothing extra without a note', async () => {
    const client = fakeClient();
    const { result } = await setup(client);
    act(() => result.current.sendFile(pdf()));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(1));
    expect(result.current.state.timeline).toHaveLength(1);
  });

  it('posts file1, file2 then the note in order, each waiting for the previous acceptance', async () => {
    const releases: (() => void)[] = [];
    const client = fakeClient({
      uploadFile: vi
        .fn()
        .mockResolvedValueOnce({ id: 'fil_1', mimeType: 'application/pdf' })
        .mockResolvedValueOnce({ id: 'fil_2', mimeType: 'application/pdf' }),
      sendMessage: vi.fn(() => new Promise((resolve) => releases.push(() => resolve({})))),
    });
    const { result } = await setup(client);
    const second = new File(['%PDF-1.4'], 'verso.pdf', { type: 'application/pdf' });
    act(() => result.current.sendFiles([pdf(), second], 'note'));
    const timeline = result.current.state.timeline as { id: string; attachment?: { name: string }; display?: string }[];
    expect(timeline.map((e) => e.attachment?.name ?? e.display)).toEqual(['doc.pdf', 'verso.pdf', 'note']);
    const batchIds = (result.current.state.timeline as { batchId?: string }[]).map((e) => e.batchId);
    expect(batchIds[0]).toMatch(/^batch_/);
    expect(new Set(batchIds).size).toBe(1);

    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(client.sendMessage).toHaveBeenCalledTimes(1); // file 2 uploaded but waits
    act(() => releases[0]());
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(client.sendMessage).toHaveBeenCalledTimes(2); // note waits for file 2
    act(() => releases[1]());
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(3));
    expect(contents(client).map((c) => c.id)).toEqual(timeline.map((e) => e.id));
    expect(contents(client)[2].content).toEqual({ type: 'text', text: 'note' });
  });

  it('holds file2 and the note while file1 upload fails, then resumes after a successful retry', async () => {
    const client = fakeClient({
      uploadFile: vi
        .fn()
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValueOnce({ id: 'fil_2', mimeType: 'application/pdf' })
        .mockResolvedValueOnce({ id: 'fil_1', mimeType: 'application/pdf' }),
    });
    const { result } = await setup(client);
    act(() => result.current.sendFiles([pdf(), new File(['%PDF-1.4'], 'verso.pdf', { type: 'application/pdf' })], 'note'));
    await waitFor(() => expect(result.current.state.timeline[0]).toMatchObject({ delivery: 'uploadFailed' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(client.sendMessage).not.toHaveBeenCalled();

    act(() => result.current.retry((result.current.state.timeline[0] as { id: string }).id));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(3));
    expect(contents(client).map((c) => c.content)).toEqual([
      { type: 'file', fileId: 'fil_1' },
      { type: 'file', fileId: 'fil_2' },
      { type: 'text', text: 'note' },
    ]);
  });
});
