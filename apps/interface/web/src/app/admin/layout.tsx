import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleProvider } from '@/components/admin/console/console-context';
import { AppShell } from '@/components/admin/shell/app-shell';
import { AccessDenied } from '@/components/admin/shell/access-denied';
import { DEPARTMENT_COOKIE, isDepartmentId } from '@/server/admin-department';
import { readSession } from '@/server/auth/session';

export const metadata: Metadata = {
  title: 'Console d’administration',
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Read-only here: tokens are refreshed by the API routes. The layout cannot see the path, so deep links land on /admin.
  const { user } = await readSession();
  if (!user || user.refreshExpiresAt <= Date.now()) redirect('/auth/login?returnTo=/admin');
  if (!user.roles.includes('official')) return <AccessDenied />;

  const department = (await cookies()).get(DEPARTMENT_COOKIE)?.value;

  return (
    <ConsoleProvider initialDepartmentId={isDepartmentId(department) ? department : null}>
      <AppShell>{children}</AppShell>
    </ConsoleProvider>
  );
}
