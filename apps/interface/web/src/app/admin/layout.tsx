import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { ConsoleProvider } from '@/components/admin/console/console-context';
import { AppShell } from '@/components/admin/shell/app-shell';
import { DEPARTMENT_COOKIE, isDepartmentId } from '@/server/admin-department';

export const metadata: Metadata = {
  title: 'Console d’administration',
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const department = (await cookies()).get(DEPARTMENT_COOKIE)?.value;

  return (
    <ConsoleProvider initialDepartmentId={isDepartmentId(department) ? department : null}>
      <AppShell>{children}</AppShell>
    </ConsoleProvider>
  );
}
