import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useUnreadTitle } from '@/hooks/use-unread-title';

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
const setVisibility = (value: DocumentVisibilityState) => {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  visibility = 'visible';
});

describe('useUnreadTitle', () => {
  it('counts new messages while hidden and resets on return', () => {
    document.title = 'Assistant';
    const { rerender, unmount } = renderHook(({ n }) => useUnreadTitle(n), { initialProps: { n: 1 } });
    rerender({ n: 2 });
    expect(document.title).toBe('Assistant');
    act(() => setVisibility('hidden'));
    rerender({ n: 3 });
    expect(document.title).toBe('(1) Assistant');
    rerender({ n: 4 });
    expect(document.title).toBe('(2) Assistant');
    act(() => setVisibility('visible'));
    expect(document.title).toBe('Assistant');
    act(() => setVisibility('hidden'));
    rerender({ n: 5 });
    expect(document.title).toBe('(1) Assistant');
    unmount();
    expect(document.title).toBe('Assistant');
  });
});
