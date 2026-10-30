process.env.TZ = 'UTC';

import { describe, expect, it, vi } from 'vitest';
import {
  collectAll,
  conversationsByChannel,
  conversationsByDay,
  conversationsByDayAndChannel,
  staleProcedures,
  pendingItems,
  recentAudit,
  recentConversations,
} from '@/lib/dashboard-data';

const pager = (pages: number[][]) =>
  vi.fn(async ({ cursor }: { cursor: string | null; limit: number }) => {
    const index = Number(cursor ?? 0);
    return { items: pages[index], nextCursor: index + 1 < pages.length ? String(index + 1) : null };
  });

describe('collectAll', () => {
  it('follows nextCursor with limit 100 until exhausted', async () => {
    const list = pager([[1, 2], [3], [4, 5]]);
    expect(await collectAll(list, 500)).toEqual({ items: [1, 2, 3, 4, 5], partial: false });
    expect(list).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenNthCalledWith(1, { cursor: null, limit: 100 });
    expect(list).toHaveBeenNthCalledWith(2, { cursor: '1', limit: 100 });
  });

  it('stops at the cap and reports partial', async () => {
    const list = pager([[1, 2], [3, 4], [5, 6]]);
    expect(await collectAll(list, 3)).toEqual({ items: [1, 2, 3], partial: true });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('is not partial when the cap is reached exactly on the last page', async () => {
    expect(await collectAll(pager([[1, 2], [3, 4]]), 4)).toEqual({ items: [1, 2, 3, 4], partial: false });
  });
});

describe('conversationsByDay', () => {
  const now = new Date('2026-10-26T15:00:00Z');

  it('returns 14 zero-filled days, oldest first, ending today', () => {
    const days = conversationsByDay(
      [
        { createdAt: '2026-10-26T00:00:00Z' },
        { createdAt: '2026-10-26T23:59:00Z' },
        { createdAt: '2026-10-24T10:00:00Z' },
        { createdAt: '2026-10-13T10:00:00Z' },
        { createdAt: '2026-10-12T23:59:00Z' }, // before the window
        { createdAt: '2026-10-27T00:00:00Z' }, // after today
      ],
      14,
      now,
    );
    expect(days).toHaveLength(14);
    expect(days[0].key).toBe('2026-10-13');
    expect(days[13].key).toBe('2026-10-26');
    expect(days.map((day) => day.count)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2]);
  });

  it('is zero everywhere without conversations', () => {
    expect(conversationsByDay([], 14, now).every((day) => day.count === 0)).toBe(true);
  });
});

describe('conversationsByChannel', () => {
  it('keeps the fixed order and zeros', () => {
    expect(conversationsByChannel([{ channel: 'mobile' }, { channel: 'web' }, { channel: 'mobile' }])).toEqual([
      { channel: 'web', count: 1 },
      { channel: 'whatsapp', count: 0 },
      { channel: 'mobile', count: 2 },
    ]);
  });
});

describe('pendingItems', () => {
  const procedure = (id: string, validationStatus: 'draft' | 'validated') => ({ id, title: `T ${id}`, validationStatus }) as any;
  const model = (active: boolean) => ({ id: 'm', active }) as any;

  it('lists drafts, disabled tools and the missing active model', () => {
    expect(
      pendingItems(
        [procedure('a', 'draft'), procedure('b', 'validated')],
        [{ name: 'x', enabled: false }, { name: 'y', enabled: true }] as any,
        [model(false)],
      ),
    ).toEqual({ draftProcedures: [{ id: 'a', title: 'T a' }], disabledTools: [{ name: 'x' }], noActiveModel: true });
  });

  it('is empty when everything is fine', () => {
    expect(pendingItems([procedure('b', 'validated')], [{ name: 'y', enabled: true }] as any, [model(true)])).toEqual({
      draftProcedures: [],
      disabledTools: [],
      noActiveModel: false,
    });
  });
});

describe('recent lists', () => {
  it('sorts audit by at desc and keeps 5', () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, at: `2026-10-0${i + 1}T10:00:00Z` })) as any[];
    expect(recentAudit([...entries].reverse().sort(() => 0), 5).map((e) => e.id)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2']);
  });

  it('sorts conversations by createdAt desc', () => {
    const convs = [
      { id: 'a', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'b', createdAt: '2026-10-03T00:00:00Z' },
      { id: 'c', createdAt: '2026-10-02T00:00:00Z' },
    ] as any[];
    expect(recentConversations(convs, 2).map((c) => c.id)).toEqual(['b', 'c']);
  });
});

describe('conversationsByDayAndChannel', () => {
  it('splits each day by channel', () => {
    const now = new Date('2026-10-26T15:00:00Z');
    const days = conversationsByDayAndChannel(
      [
        { createdAt: '2026-10-26T01:00:00Z', channel: 'web' },
        { createdAt: '2026-10-26T02:00:00Z', channel: 'mobile' },
        { createdAt: '2026-10-25T02:00:00Z', channel: 'whatsapp' },
      ],
      14,
      now,
    );
    expect(days[13].channels).toEqual({ web: 1, whatsapp: 0, mobile: 1 });
    expect(days[13].count).toBe(2);
    expect(days[12].channels).toEqual({ web: 0, whatsapp: 1, mobile: 0 });
  });
});

describe('staleProcedures', () => {
  it('keeps sources retrieved more than 90 days ago', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    const p = (id: string, retrievedAt: string) => ({ id, source: { retrievedAt } }) as any;
    expect(
      staleProcedures([p('old', '2026-07-01T00:00:00Z'), p('new', '2026-09-01T00:00:00Z'), p('bad', 'x')], now).map((x) => x.id),
    ).toEqual(['old']);
  });
});
