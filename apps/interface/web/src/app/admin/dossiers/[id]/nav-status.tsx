'use client';

import { useLayoutEffect, useState } from 'react';
import { ReportActiveCaseStatus } from '@/components/admin/shell/active-case-status';
import type { CaseStatus } from '@/lib/admin/api';
import { subscribeLoadedCase } from '@/lib/admin/case-events';

/** Reads the case already loaded on the detail page (getCase / act) and tells the shell which tab to highlight. */
export function DossierNavStatus({ id }: { id: string }) {
  const [status, setStatus] = useState<CaseStatus | null>(null);

  useLayoutEffect(() => {
    setStatus(null);
    return subscribeLoadedCase((item) => {
      if (item.id === id) setStatus(item.status);
    });
  }, [id]);

  return <ReportActiveCaseStatus status={status} />;
}
