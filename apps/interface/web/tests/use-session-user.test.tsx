import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionUser } from '@/hooks/use-session-user';
import { announceSessionChanged } from '@/lib/session-events';

let fetchMock: ReturnType<typeof vi.fn>;
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useSessionUser', () => {
  it('reads again after announceSessionChanged, without going back to checking', async () => {
    fetchMock.mockResolvedValueOnce(reply({ user: null, signIn: 'npi' }));
    const { result } = renderHook(() => useSessionUser());
    expect(result.current.status).toBe('checking');
    await waitFor(() => expect(result.current.status).toBe('guest'));

    const seen: string[] = [];
    fetchMock.mockResolvedValueOnce(reply({ user: { name: 'Awa' }, signIn: 'npi' }));
    act(() => announceSessionChanged());
    seen.push(result.current.status);
    await waitFor(() => expect(result.current.status).toBe('user'));
    expect(seen).toEqual(['guest']);
    expect(result.current.name).toBe('Awa');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale response and stops listening after unmount', async () => {
    let releaseFirst!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (releaseFirst = resolve)));
    const { result, unmount } = renderHook(() => useSessionUser());
    fetchMock.mockResolvedValueOnce(reply({ user: { name: 'Awa' }, signIn: 'npi' }));
    act(() => announceSessionChanged());
    await waitFor(() => expect(result.current.status).toBe('user'));
    await act(async () => releaseFirst(reply({ user: null, signIn: 'npi' })));
    expect(result.current.status).toBe('user');
    unmount();
    announceSessionChanged();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
