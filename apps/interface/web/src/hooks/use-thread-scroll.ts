'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Distance (px) from the bottom under which the thread follows new messages. */
const STICK_THRESHOLD = 96;
/** A newest agent message taller than the viewport minus this is read from its top. */
const TALL_MARGIN = 80;
/** Space kept above a top-anchored message. */
const ANCHOR_OFFSET = 16;
/** Fallback end of a smooth scroll when `scrollend` is not supported. */
const SMOOTH_FALLBACK_MS = 450;
const INSTANT_FALLBACK_MS = 100;

export type LatestEntry = { key: string; kind: 'user' | 'agent' };

/**
 * Single owner of the thread scroll. Every programmatic scroll goes through `run`; while it lasts,
 * `onScroll` leaves `stick` alone and the ResizeObserver does nothing.
 * Entries must carry `data-entry-id`; a group header right before an entry carries `data-group-header`.
 */
export function useThreadScroll(latest: LatestEntry | null) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  // Follow new messages only while the reader is at the bottom, like a messaging app.
  const stick = useRef(true);
  const topAnchored = useRef(false);
  const programmatic = useRef(false);
  const pendingFollow = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  const handledKey = useRef<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const gap = () => {
    const el = scrollRef.current;
    return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
  };

  const followBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    else el.scrollTop = el.scrollHeight;
  };

  const run = useCallback((top: number, smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    cleanup.current?.();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    if (typeof el.scrollTo !== 'function') {
      el.scrollTop = top;
      setAtBottom(el.scrollHeight - top - el.clientHeight < STICK_THRESHOLD);
      return;
    }
    const animate = smooth && !reduce;
    programmatic.current = true;
    const finish = () => {
      cleanup.current?.();
      cleanup.current = null;
      programmatic.current = false;
      // Content that grew during the scroll (waiting line, reveal) is caught up without animation.
      if (pendingFollow.current && stick.current && !topAnchored.current && gap() > 1) followBottom();
      pendingFollow.current = false;
      setAtBottom(gap() < STICK_THRESHOLD);
    };
    const timer = window.setTimeout(finish, animate ? SMOOTH_FALLBACK_MS : INSTANT_FALLBACK_MS);
    el.addEventListener('scrollend', finish, { once: true });
    cleanup.current = () => {
      window.clearTimeout(timer);
      el.removeEventListener('scrollend', finish);
    };
    el.scrollTo({ top, behavior: animate ? 'smooth' : 'instant' });
  }, []);

  const scrollToBottom = useCallback(
    (smooth: boolean) => {
      topAnchored.current = false;
      const el = scrollRef.current;
      if (el) run(el.scrollHeight, smooth);
    },
    [run],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || programmatic.current) return;
    const near = gap() < STICK_THRESHOLD;
    stick.current = near;
    topAnchored.current = false;
    setAtBottom(near);
  };

  /** Where to scroll for a new agent message: its top when it is taller than the viewport, else the bottom. */
  const anchorTop = (id: string): number | null => {
    const el = scrollRef.current;
    const entry = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []).find(
      (node) => node.dataset.entryId === id,
    );
    if (!el || !entry) return null;
    const header = entry.previousElementSibling?.hasAttribute('data-group-header') ? entry.previousElementSibling : null;
    const box = entry.getBoundingClientRect();
    const top = (header ?? entry).getBoundingClientRect().top;
    if (box.bottom - top <= el.clientHeight - TALL_MARGIN) return null;
    return top - el.getBoundingClientRect().top + el.scrollTop - ANCHOR_OFFSET;
  };

  const latestKey = latest?.key ?? null;
  const latestKind = latest?.kind ?? null;
  useLayoutEffect(() => {
    if (latestKey === null || handledKey.current === latestKey) return;
    const first = handledKey.current === null;
    handledKey.current = latestKey;
    if (first) {
      scrollToBottom(false);
    } else if (latestKind === 'user') {
      stick.current = true;
      scrollToBottom(true);
    } else if (stick.current) {
      const top = anchorTop(latestKey);
      if (top === null) scrollToBottom(true);
      else {
        topAnchored.current = true;
        run(top, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestKey, latestKind]);

  // Content growing in place (word reveal, form submitted, images, fonts) keeps the bottom in view.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (programmatic.current) {
        pendingFollow.current = true;
        return;
      }
      if (stick.current && !topAnchored.current && gap() > 1) followBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  const jumpToLatest = useCallback(() => {
    stick.current = true;
    scrollToBottom(true);
  }, [scrollToBottom]);

  return { scrollRef, contentRef, onScroll, atBottom, jumpToLatest };
}
