import { describe, expect, it } from 'vitest';
import { CONTRACT_MIME_TYPES, MAX_FILE_BYTES, contentTypeFor, formatFileSize, mimeLabels, validateFile } from '@/lib/files';

describe('validateFile', () => {
  const all = CONTRACT_MIME_TYPES;
  it('rejects empty files', () => {
    expect(validateFile({ size: 0, type: 'application/pdf' }, all)).toEqual({ ok: false, error: 'Le fichier est vide.' });
  });
  it('rejects files over 10 Mio and accepts exactly 10 Mio', () => {
    expect(validateFile({ size: MAX_FILE_BYTES + 1, type: 'application/pdf' }, all)).toEqual({
      ok: false,
      error: 'Fichier trop volumineux (10 Mo maximum).',
    });
    expect(validateFile({ size: 10485760, type: 'application/pdf' }, all)).toEqual({
      ok: true,
      mimeType: 'application/pdf',
    });
  });
  it('intersects accepted with contract types', () => {
    expect(validateFile({ size: 1, type: 'image/png' }, ['application/pdf'])).toEqual({
      ok: false,
      error: 'Format non accepté. Formats acceptés : PDF.',
    });
    expect(validateFile({ size: 1, type: 'text/plain' }, ['application/pdf', 'text/plain'])).toMatchObject({ ok: false });
    expect(validateFile({ size: 1, type: 'text/plain' }, ['text/plain'])).toEqual({
      ok: false,
      error: 'Format non accepté. Formats acceptés : .',
    });
  });
});

describe('helpers', () => {
  it('maps content types', () => {
    expect(contentTypeFor('image/png')).toBe('file');
    expect(contentTypeFor('audio/webm')).toBe('audio');
    expect(contentTypeFor('audio/ogg')).toBe('audio');
    expect(contentTypeFor('application/pdf')).toBe('file');
  });
  it('formats sizes in French', () => {
    expect(formatFileSize(850)).toBe('850 o');
    expect(formatFileSize(12.4 * 1024)).toMatch(/^12,4 Ko$/);
    expect(formatFileSize(3.2 * 1024 * 1024)).toMatch(/^3,2 Mo$/);
  });
  it('labels mime types', () => {
    expect(mimeLabels(['application/pdf', 'audio/mpeg', 'audio/mp4', 'x/y'])).toBe('PDF, MP3, M4A, x/y');
  });
});
