// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM mock server without types
import { startMocks } from '../../../../mocks/server.mjs';
import { C1Client } from '@/lib/c1-client';
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

describe('widget <-> proxy <-> mock backend', () => {
  it('creates a conversation, sends a message and receives the agent reply', async () => {
    const shim: typeof fetch = async (input, init) => {
      const url = new URL(String(input), 'http://widget.local');
      const path = url.pathname.replace(/^\/api\/backend\//, '').split('/');
      return proxyToBackend(new Request(url, init), path, {
        backendUrl: mocks.backendUrl,
        getUserToken: () => 'mock-user',
        fetch,
      });
    };
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
});
