import { describe, expect, it } from 'vitest';
import { canSeeProcedure, visibleProcedures } from '@/lib/visible-procedures';
import { adminRead, adminWrite, platform } from './helpers/session';

const items = [
  { id: 'a', administrationId: 'justice' },
  { id: 'b', administrationId: 'mairie-cotonou' },
  { id: 'c', administrationId: 'justice' },
];

describe('visibleProcedures', () => {
  it('keeps everything for the platform', () => {
    expect(visibleProcedures(platform, items)).toEqual(items);
  });

  it('keeps only the own administration for an administration identity', () => {
    expect(visibleProcedures(adminWrite, items).map((item) => item.id)).toEqual(['a', 'c']);
    expect(visibleProcedures(adminRead, items).map((item) => item.id)).toEqual(['b']);
  });

  it('shows nothing without an identity, and does not mutate the input', () => {
    expect(visibleProcedures(null, items)).toEqual([]);
    expect(items).toHaveLength(3);
  });

  it('canSeeProcedure applies the same rule to one fiche', () => {
    expect(canSeeProcedure(adminWrite, items[1])).toBe(false);
    expect(canSeeProcedure(adminWrite, items[0])).toBe(true);
    expect(canSeeProcedure(platform, items[1])).toBe(true);
  });
});
