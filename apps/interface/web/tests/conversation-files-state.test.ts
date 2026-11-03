import { describe, expect, it } from 'vitest';
import { conversationReducer, initialState, type ConversationState } from '@/lib/conversation-state';
import type { EventPage, UploadedFile } from '@/lib/c1-client';
import { userEvent } from './fixtures-v2';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const pad = (n: number) => String(n).padStart(26, '0');
const MSG = `msg_${pad(1)}`;
const attachment = { name: 'doc.pdf', sizeBytes: 1200, mimeType: 'application/pdf' };
const file = (): UploadedFile => ({
  id: `fil_${pad(1)}`,
  mimeType: 'application/pdf',
  sizeBytes: 1200,
  expiresAt: '2026-11-03T18:00:00Z',
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
    s = conversationReducer(s, { type: 'fileUploadSucceeded', id: MSG, file: file(), documentType: null });
    expect(user(s)).toMatchObject({
      delivery: 'sending',
      content: { type: 'file', fileId: `fil_${pad(1)}`, documentType: null },
    });
    s = conversationReducer(s, { type: 'userMessageAccepted', id: MSG });
    expect(user(s).delivery).toBe('accepted');
    const page: EventPage = {
      items: [userEvent(1, { type: 'file', fileId: `fil_${pad(1)}`, documentType: null }, { messageId: MSG, conversationId: CNV })],
      nextCursor: `evt_${pad(1)}`,
    };
    s = conversationReducer(s, { type: 'eventsReceived', page });
    expect(user(s).delivery).toBe('received');
  });

  it('sends an uploaded file at once: no antivirus scan state in v2', () => {
    const s = conversationReducer(started(), { type: 'fileUploadSucceeded', id: MSG, file: file(), documentType: null });
    expect(user(s)).toMatchObject({ delivery: 'sending', error: undefined });
    expect(user(s).attachment).toEqual(attachment);
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

describe('file message content', () => {
  it('carries the documentType of the fileRequest it answers', () => {
    const s = conversationReducer(started(), { type: 'fileUploadSucceeded', id: MSG, file: file(), documentType: 'extrait-acte-naissance' });
    expect(user(s).content).toEqual({ type: 'file', fileId: `fil_${pad(1)}`, documentType: 'extrait-acte-naissance' });
  });

  it('is audio {fileId} for a voice message and never an image type', () => {
    const voice: UploadedFile = { ...file(), mimeType: 'audio/webm' };
    const s = conversationReducer(started(), { type: 'fileUploadSucceeded', id: MSG, file: voice, documentType: null });
    expect(user(s).content).toEqual({ type: 'audio', fileId: `fil_${pad(1)}` });
    const png = conversationReducer(started(), { type: 'fileUploadSucceeded', id: MSG, file: { ...file(), mimeType: 'image/png' }, documentType: null });
    expect(user(png).content).toMatchObject({ type: 'file' });
  });
});

describe('batchId', () => {
  const ready = () => conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV });
  const sentAt = '2026-10-22T18:00:00Z';

  it('is stored on file entries and on the queued note', () => {
    let s = conversationReducer(ready(), { type: 'fileUploadStarted', id: MSG, attachment, sentAt, batchId: 'batch_1' });
    s = conversationReducer(s, {
      type: 'userMessageQueued',
      id: `msg_${pad(2)}`,
      content: { type: 'text', text: 'n' },
      display: 'n',
      sentAt,
      batchId: 'batch_1',
    });
    expect(s.timeline.map((e) => e.kind === 'user' && e.batchId)).toEqual(['batch_1', 'batch_1']);
  });

  it('keeps the existing batchId on retry paths', () => {
    let s = conversationReducer(ready(), { type: 'fileUploadStarted', id: MSG, attachment, sentAt, batchId: 'batch_1' });
    s = conversationReducer(s, { type: 'fileUploadFailed', id: MSG, error: 'x', retryable: true });
    s = conversationReducer(s, { type: 'fileUploadStarted', id: MSG, attachment, sentAt });
    expect(user(s)).toMatchObject({ delivery: 'uploading', batchId: 'batch_1' });
    s = conversationReducer(s, { type: 'fileUploadSucceeded', id: MSG, file: file(), documentType: null });
    s = conversationReducer(s, { type: 'userMessageFailed', id: MSG });
    s = conversationReducer(s, { type: 'userMessageQueued', id: MSG, content: { type: 'text', text: '' }, display: '', sentAt });
    expect(user(s)).toMatchObject({ delivery: 'sending', batchId: 'batch_1' });
  });
});
