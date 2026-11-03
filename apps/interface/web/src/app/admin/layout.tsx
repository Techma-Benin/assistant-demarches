import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleProvider } from '@/components/admin/console/console-context';
import { AppShell } from '@/components/admin/shell/app-shell';
import { AccessDenied } from '@/components/admin/shell/access-denied';
import { ADMINISTRATION_COOKIE, isAdministrationId } from '@/server/admin-administration';
import { readSession } from '@/server/auth/session';

export const metadata: Metadata = {
  title: 'Console d’administration',
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Read-only here: tokens are refreshed by the API routes. The layout cannot see the path, so deep links land on /admin.
  const { user } = await readSession();
  if (!user || user.refreshExpiresAt <= Date.now()) redirect('/auth/login?returnTo=/admin');
  if (!user.roles.includes('official')) return <AccessDenied />;

  const administration = (await cookies()).get(ADMINISTRATION_COOKIE)?.value;

  return (
    <ConsoleProvider initialAdministrationId={isAdministrationId(administration) ? administration : null}>
      <AppShell>{children}</AppShell>
    </ConsoleProvider>
  );
}
