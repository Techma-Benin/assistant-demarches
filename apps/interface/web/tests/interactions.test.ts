import { describe, expect, it } from 'vitest';
import { buttonInteraction, fileContent, formInteraction } from '@/lib/interactions';

describe('interactions', () => {
  it('builds a button interaction', () => {
    expect(buttonInteraction({ id: 'go', label: 'Aller' })).toEqual({ type: 'interaction', actionId: 'go', value: null });
  });

  it('builds a form interaction with JSON value (provisional)', () => {
    expect(formInteraction('f1', { a: '1', b: 'x' })).toEqual({
      type: 'interaction',
      actionId: 'f1',
      value: '{"a":"1","b":"x"}',
    });
  });

  it('builds file contents: audio {fileId}, file {fileId, documentType}', () => {
    const id = 'fil_' + '0'.repeat(26);
    expect(fileContent({ id, mimeType: 'audio/webm' }, 'ignored')).toEqual({ type: 'audio', fileId: id });
    expect(fileContent({ id, mimeType: 'application/pdf' }, 'extrait-acte-naissance')).toEqual({
      type: 'file',
      fileId: id,
      documentType: 'extrait-acte-naissance',
    });
    expect(fileContent({ id, mimeType: 'image/png' }, null)).toEqual({ type: 'file', fileId: id, documentType: null });
  });
});
