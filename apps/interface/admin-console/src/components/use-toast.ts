'use client';

import { useCallback, useState } from 'react';

/** Message for the `Toast`; `dismiss` is stable (the Toast timer depends on it). */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const dismiss = useCallback(() => setMessage(null), []);
  return { message, show: setMessage, dismiss };
}
