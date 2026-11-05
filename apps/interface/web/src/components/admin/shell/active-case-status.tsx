'use client';

import { createContext, useContext, useLayoutEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { CaseStatus } from '@/lib/admin/api';

const SetActiveCaseStatusContext = createContext<Dispatch<SetStateAction<CaseStatus | null>> | null>(null);

export function ActiveCaseStatusProvider({
  children,
  onStatus,
}: {
  children: ReactNode;
  onStatus: Dispatch<SetStateAction<CaseStatus | null>>;
}) {
  return <SetActiveCaseStatusContext.Provider value={onStatus}>{children}</SetActiveCaseStatusContext.Provider>;
}

/** Lets a dossier page (or a test) tell the shell which queue tab to highlight. */
export function ReportActiveCaseStatus({ status }: { status: CaseStatus | null }) {
  const set = useContext(SetActiveCaseStatusContext);
  useLayoutEffect(() => {
    if (!set) return;
    set(status);
  }, [status, set]);
  useLayoutEffect(() => () => set?.(null), [set]);
  return null;
}
