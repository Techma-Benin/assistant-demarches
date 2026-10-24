// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM mock server without types
import { startMocks } from '../../../../mocks/server.mjs';
import { C1Client, C1Error, type ConversationEvent } from '@/lib/c1-client';
import { ConversationStream, type StreamStatus } from '@/lib/conversation-stream';
import { conversationReducer, initialState } from '@/lib/conversation-state';
import { newId } from '@/lib/ids';
import { proxyToBackend } from '@/server/backend-proxy';

type Mocks = { backendUrl: string; close: () => Promise<void> };
let mocks: Mocks;

beforeAll(async () => {
  mocks = await startMocks({ backendPort: 0, toolingPort: 0 });
});
afterAll(async () => {
  await mocks.close();
});

const shim: typeof fetch = async (input, init) => {
  const url = new URL(String(input), 'http://widget.local');
  const path = url.pathname.replace(/^\/api\/backend\//, '').split('/');
  return proxyToBackend(new Request(url, init), path, {
    backendUrl: mocks.backendUrl,
    getUserToken: () => 'mock-user',
    fetch,
  });
};

describe('widget <-> proxy <-> mock backend', () => {
  it('creates a conversation, sends a message and receives the agent reply', async () => {
    const client = new C1Client(shim);

    const conversation = await client.createConversation({ channel: 'web', locale: 'fr' }, crypto.randomUUID());
    let state = conversationReducer(initialState, { type: 'conversationStarted', conversationId: conversation.id });

    const input = {
      id: newId('msg'),
      content: { type: 'text' as const, text: 'Bonjour' },
      sentAt: new Date().toISOString(),
    };
    state = conversationReducer(state, {
      type: 'userMessageQueued',
      id: input.id,
      content: input.content,
      display: 'Bonjour',
      sentAt: input.sentAt,
    });
    const accepted = await client.sendMessage(conversation.id, input);
    expect(accepted.status).toBe('accepted');
    state = conversationReducer(state, { type: 'userMessageAccepted', id: input.id });

    for (let i = 0; i < 20 && !state.timeline.some((e) => e.kind === 'agent'); i++) {
      const page = await client.listEvents(conversation.id, state.cursor);
      state = conversationReducer(state, { type: 'eventsReceived', page });
      if (!state.timeline.some((e) => e.kind === 'agent')) await new Promise((r) => setTimeout(r, 50));
    }

    const agents = state.timeline.filter((e) => e.kind === 'agent');
    expect(agents).toHaveLength(1);
    expect(agents[0].kind === 'agent' && agents[0].message.blocks[0].type).toBe('text');
    expect(state.timeline.find((e) => e.kind === 'user')).toMatchObject({ delivery: 'received' });

    // Replaying from scratch does not duplicate anything.
    const replay = await client.listEvents(conversation.id);
    const again = conversationReducer(state, { type: 'eventsReceived', page: replay });
    expect(again.timeline).toEqual(state.timeline);
  });

  it('uploads a file, sends it as a message and receives message.received', async () => {
    const client = new C1Client(shim);
    const conversation = await client.createConversation({ channel: 'web', locale: 'fr' }, crypto.randomUUID());
    let state = conversationReducer(initialState, { type: 'conversationStarted', conversationId: conversation.id });
    const id = newId('msg');
    const sentAt = new Date().toISOString();
    const attachment = { name: 'doc.pdf', sizeBytes: 8, mimeType: 'application/pdf' };
    state = conversationReducer(state, { type: 'fileUploadStarted', id, attachment, sentAt });

    const uploaded = await client.uploadFile(
      new Blob([new TextEncoder().encode('%PDF-1.4')]),
      'application/pdf',
      crypto.randomUUID(),
    );
    expect(uploaded).toMatchObject({ scanStatus: 'clean', mimeType: 'application/pdf' });
    expect(uploaded.id).toMatch(/^fil_/);
    state = conversationReducer(state, { type: 'fileUploadSucceeded', id, file: uploaded });

    await client.sendMessage(conversation.id, { id, content: { type: 'file', fileId: uploaded.id }, sentAt });
    state = conversationReducer(state, { type: 'userMessageAccepted', id });

    for (let i = 0; i < 20 && state.timeline[0]?.kind === 'user' && state.timeline[0].delivery !== 'received'; i++) {
      state = conversationReducer(state, { type: 'eventsReceived', page: await client.listEvents(conversation.id, state.cursor) });
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(state.timeline[0]).toMatchObject({
      kind: 'user',
      delivery: 'received',
      attachment: { name: 'doc.pdf', scanStatus: 'clean' },
      content: { type: 'file', fileId: uploaded.id },
    });
  });

  it('maps a wrong x-file-mime-type to a 415 C1Error', async () => {
    const client = new C1Client(shim);
    const error = await client
      .uploadFile(new Blob(['hello']), 'text/plain' as never, crypto.randomUUID())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(C1Error);
    expect((error as C1Error).status).toBe(415);
  });

  it('streams over the WebSocket, resumes with the cursor after a drop and never duplicates', async () => {
    const client = new C1Client(shim);
    const conversation = await client.createConversation({ channel: 'web', locale: 'fr' }, crypto.randomUUID());
    let state = conversationReducer(initialState, { type: 'conversationStarted', conversationId: conversation.id });
    const delivered: ConversationEvent[] = [];
    const statuses: StreamStatus[] = [];
    const sockets: WebSocket[] = [];
    class RecordingWebSocket extends WebSocket {
      constructor(url: string | URL) {
        super(url);
        sockets.push(this);
      }
    }
    const stream = new ConversationStream({
      client,
      conversationId: conversation.id,
      onEvents: (items) => {
        delivered.push(...items);
        state = conversationReducer(state, { type: 'eventsReceived', page: { items, nextCursor: items[items.length - 1].id } });
      },
      onReplayExpired: () => {
        state = conversationReducer(state, { type: 'replayExpired' });
      },
      onStatus: (status) => statuses.push(status),
      onFatal: (status) => {
        throw new Error(`unexpected fatal ${status}`);
      },
      WebSocketImpl: RecordingWebSocket,
    });
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 50));
      expect(condition()).toBe(true);
    };
    const send = async (text: string) => {
      const input = { id: newId('msg'), content: { type: 'text' as const, text }, sentAt: new Date().toISOString() };
      state = conversationReducer(state, {
        type: 'userMessageQueued',
        id: input.id,
        content: input.content,
        display: text,
        sentAt: input.sentAt,
      });
      await client.sendMessage(conversation.id, input);
      state = conversationReducer(state, { type: 'userMessageAccepted', id: input.id });
    };
    const agents = () => state.timeline.filter((e) => e.kind === 'agent').length;

    try {
      stream.start();
      await until(() => statuses.includes('live'));
      expect(sockets).toHaveLength(1);

      await send('Bonjour');
      await until(() => delivered.some((e) => e.data.kind === 'message.sent'));
      await until(() => state.timeline.some((e) => e.kind === 'user' && e.delivery === 'received'));
      expect(agents()).toBe(1);

      // Drop the connection from the client side, then send while disconnected.
      sockets[0].close(4000);
      await send('Merci');
      await until(() => sockets.length === 2 && statuses.at(-1) === 'live');
      await until(() => agents() === 2);
      await until(() => state.timeline.filter((e) => e.kind === 'user' && e.delivery === 'received').length === 2);

      expect(statuses).toContain('polling');
      const ids = delivered.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(agents()).toBe(2);
    } finally {
      stream.stop();
    }
  });
});
