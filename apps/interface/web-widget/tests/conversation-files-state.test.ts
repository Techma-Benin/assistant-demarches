import { describe, expect, it } from 'vitest';
import { conversationReducer, initialState, type ConversationState } from '@/lib/conversation-state';
import type { EventPage, UploadedFile } from '@/lib/c1-client';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const pad = (n: number) => String(n).padStart(26, '0');
const MSG = `msg_${pad(1)}`;
const attachment = { name: 'doc.pdf', sizeBytes: 1200, mimeType: 'application/pdf' };
const file = (scanStatus: UploadedFile['scanStatus']): UploadedFile => ({
  id: `fil_${pad(1)}`,
  mimeType: 'application/pdf',
  sizeBytes: 1200,
  scanStatus,
  expiresAt: '2026-10-23T18:00:00Z',
});

function started(): ConversationState {
  const s = conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV });
  return conversationReducer(s, { type: 'fileUploadStarted', id: MSG, attachment, sentAt: '2026-10-22T18:00:00Z' });
}
const user = (s: ConversationState) => {
  const e = s.timeline[0];
  if (e.kind !== 'user') throw new Error('expected user entry');
  return e;
};

describe('file upload states', () => {
  it('goes uploading -> sending -> accepted -> received', () => {
    let s = started();
    expect(user(s)).toMatchObject({ delivery: 'uploading', content: null, attachment });
    s = conversationReducer(s, { type: 'fileUploadSucceeded', id: MSG, file: file('clean') });
    expect(user(s)).toMatchObject({
      delivery: 'sending',
      content: { type: 'file', fileId: `fil_${pad(1)}` },
      attachment: { scanStatus: 'clean' },
    });
    s = conversationReducer(s, { type: 'userMessageAccepted', id: MSG });
    expect(user(s).delivery).toBe('accepted');
    const page: EventPage = {
      items: [
        {
          specversion: '1.0',
          id: `evt_${pad(1)}`,
          source: 'urn:techma:backend',
          type: 'bj.techma.message.received.v1',
          time: '2026-10-22T18:00:00Z',
          datacontenttype: 'application/json',
          traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01',
          data: { kind: 'message.received', conversationId: CNV, messageId: MSG },
        },
      ],
      nextCursor: `evt_${pad(1)}`,
    };
    s = conversationReducer(s, { type: 'eventsReceived', page });
    expect(user(s).delivery).toBe('received');
  });

  it('marks a rejected scan', () => {
    const s = conversationReducer(started(), { type: 'fileUploadSucceeded', id: MSG, file: file('rejected') });
    expect(user(s)).toMatchObject({
      delivery: 'scanRejected',
      error: 'Pièce refusée par l’analyse de sécurité.',
    });
  });

  it('keeps a pending scan in sending', () => {
    const s = conversationReducer(started(), { type: 'fileUploadSucceeded', id: MSG, file: file('pending') });
    expect(user(s)).toMatchObject({ delivery: 'sending', attachment: { scanStatus: 'pending' } });
  });

  it('records retryable and non-retryable failures, retry resets to uploading', () => {
    let s = conversationReducer(started(), { type: 'fileUploadFailed', id: MSG, error: 'boom', retryable: true });
    expect(user(s)).toMatchObject({ delivery: 'uploadFailed', error: 'boom', retryable: true });
    s = conversationReducer(s, { type: 'fileUploadStarted', id: MSG, attachment, sentAt: 'x' });
    expect(user(s)).toMatchObject({ delivery: 'uploading', error: undefined });
    expect(s.timeline).toHaveLength(1);
    s = conversationReducer(s, { type: 'fileUploadFailed', id: MSG, error: 'no', retryable: false });
    expect(user(s)).toMatchObject({ delivery: 'uploadFailed', retryable: false });
  });
});
