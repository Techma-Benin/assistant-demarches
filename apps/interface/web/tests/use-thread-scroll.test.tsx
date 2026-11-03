import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThreadScroll, type LatestEntry } from '@/hooks/use-thread-scroll';

let roCallback: (() => void) | null = null;
class FakeResizeObserver {
  constructor(cb: () => void) {
    roCallback = cb;
  }
  observe() {}
  disconnect() {}
}

function Harness({ latest, jump }: { latest: LatestEntry | null; jump?: { current: (() => void) | null } }) {
  const t = useThreadScroll(latest);
  if (jump) jump.current = t.jumpToLatest;
  return (
    <div ref={t.scrollRef} onScroll={t.onScroll} data-testid="thread">
      <main ref={t.contentRef}>
        <div data-entry-id="a1" />
      </main>
      <span data-testid="at-bottom">{String(t.atBottom)}</span>
    </div>
  );
}

const layout = (el: HTMLElement, v: { scrollHeight: number; clientHeight: number; scrollTop?: number }) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: v.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: v.clientHeight });
  el.scrollTop = v.scrollTop ?? 0;
};

describe('useThreadScroll', () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    roCallback = null;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // @ts-expect-error cleanup of the stub
    delete Element.prototype.scrollTo;
  });

  const user = (key: string): LatestEntry => ({ key, kind: 'user' });
  const agent = (key: string): LatestEntry => ({ key, kind: 'agent' });

  it('performs exactly one smooth scroll per user send', () => {
    const { rerender, getByTestId } = render(<Harness latest={user('u1')} />);
    layout(getByTestId('thread'), { scrollHeight: 1000, clientHeight: 400 });
    scrollTo.mockClear();
    rerender(<Harness latest={user('u2')} />);
    // Delivery updates or re-renders with the same last entry never scroll again.
    rerender(<Harness latest={user('u2')} />);
    rerender(<Harness latest={user('u2')} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('does not touch the scroll position from the ResizeObserver or onScroll while a scroll is running', () => {
    const { rerender, getByTestId } = render(<Harness latest={user('u1')} />);
    const thread = getByTestId('thread');
    layout(thread, { scrollHeight: 1000, clientHeight: 400 });
    rerender(<Harness latest={user('u2')} />);
    scrollTo.mockClear();
    layout(thread, { scrollHeight: 1100, clientHeight: 400, scrollTop: 300 });
    act(() => roCallback?.());
    expect(scrollTo).not.toHaveBeenCalled();
    // A scroll event fired by the animation must not unstick the thread.
    act(() => void thread.dispatchEvent(new Event('scroll')));
    act(() => void vi.advanceTimersByTime(450));
    // Once finished, the growth is caught up instantly while stuck.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: 'instant' });
  });

  it('follows content growth instantly when stuck, but not after the reader scrolled up', () => {
    const { getByTestId } = render(<Harness latest={agent('a1')} />);
    const thread = getByTestId('thread');
    act(() => void vi.advanceTimersByTime(200));
    layout(thread, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    scrollTo.mockClear();
    layout(thread, { scrollHeight: 1050, clientHeight: 400, scrollTop: 600 });
    act(() => roCallback?.());
    expect(scrollTo).toHaveBeenCalledWith({ top: 1050, behavior: 'instant' });

    scrollTo.mockClear();
    layout(thread, { scrollHeight: 1050, clientHeight: 400, scrollTop: 0 });
    act(() => void thread.dispatchEvent(new Event('scroll')));
    expect(getByTestId('at-bottom')).toHaveTextContent('false');
    act(() => roCallback?.());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('anchors a tall new agent message by its top, and does not follow the bottom afterwards', () => {
    const { rerender, getByTestId } = render(<Harness latest={user('u1')} />);
    const thread = getByTestId('thread');
    act(() => void vi.advanceTimersByTime(200));
    layout(thread, { scrollHeight: 2000, clientHeight: 400, scrollTop: 1600 });
    thread.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    const entry = thread.querySelector('[data-entry-id]') as HTMLElement;
    entry.getBoundingClientRect = () => ({ top: 700, bottom: 1500 }) as DOMRect;
    scrollTo.mockClear();
    rerender(<Harness latest={agent('a1')} />);
    // 700 - 100 + 1600 - 16
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 2184, behavior: 'smooth' });
    act(() => void vi.advanceTimersByTime(450));
    scrollTo.mockClear();
    layout(thread, { scrollHeight: 2100, clientHeight: 400, scrollTop: 2184 });
    act(() => roCallback?.());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls to the bottom for a short new agent message', () => {
    const { rerender, getByTestId } = render(<Harness latest={user('u1')} />);
    const thread = getByTestId('thread');
    act(() => void vi.advanceTimersByTime(200));
    layout(thread, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    thread.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    (thread.querySelector('[data-entry-id]') as HTMLElement).getBoundingClientRect = () => ({ top: 900, bottom: 1000 }) as DOMRect;
    scrollTo.mockClear();
    rerender(<Harness latest={agent('a1')} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('does not move the reader who scrolled up when an agent message arrives', () => {
    const { rerender, getByTestId } = render(<Harness latest={user('u1')} />);
    const thread = getByTestId('thread');
    act(() => void vi.advanceTimersByTime(200));
    layout(thread, { scrollHeight: 2000, clientHeight: 400, scrollTop: 0 });
    act(() => void thread.dispatchEvent(new Event('scroll')));
    scrollTo.mockClear();
    rerender(<Harness latest={agent('a1')} />);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
