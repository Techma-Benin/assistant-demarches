'use client';

import { useEffect, useRef } from 'react';

/** While the tab is hidden, each new agent message prefixes the document title with an unread counter. */
export function useUnreadTitle(agentMessageCount: number): void {
  const baseTitle = useRef<string | null>(null);
  const previous = useRef(agentMessageCount);
  const unread = useRef(0);

  useEffect(() => {
    const base = document.title;
    baseTitle.current = base;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        unread.current = 0;
        document.title = base;
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.title = base;
    };
  }, []);

  useEffect(() => {
    const added = agentMessageCount - previous.current;
    previous.current = agentMessageCount;
    if (added <= 0 || baseTitle.current === null || document.visibilityState !== 'hidden') return;
    unread.current += added;
    document.title = `(${unread.current}) ${baseTitle.current}`;
  }, [agentMessageCount]);
}
