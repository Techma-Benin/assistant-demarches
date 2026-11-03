import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessDenied } from '@/components/operator/shell/access-denied';
import { OperatorShell } from '@/components/operator/shell/operator-shell';
import { readSession } from '@/server/auth/session';

export const metadata: Metadata = {
  title: 'Console opérateur',
};

export default async function OperatorLayout({ children }: { children: ReactNode }) {
  // Read-only here: tokens are refreshed by the API routes. The layout cannot see the path, so deep links land on /operateur.
  const { user } = await readSession();
  if (!user || user.refreshExpiresAt <= Date.now()) redirect('/auth/login?returnTo=/operateur');
  if (!user.roles.includes('operator')) return <AccessDenied />;
  return <OperatorShell>{children}</OperatorShell>;
}
