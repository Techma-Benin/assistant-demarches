import { describe, expect, it } from 'vitest';
import { buttonInteraction, formInteraction } from '@/lib/interactions';

describe('interactions', () => {
  it('builds a button interaction', () => {
    expect(buttonInteraction({ id: 'go', label: 'Aller' })).toEqual({ type: 'interaction', actionId: 'go' });
  });

  it('builds a form interaction with JSON value (provisional)', () => {
    expect(formInteraction('f1', { a: '1', b: 'x' })).toEqual({
      type: 'interaction',
      actionId: 'f1',
      value: '{"a":"1","b":"x"}',
    });
  });
});
