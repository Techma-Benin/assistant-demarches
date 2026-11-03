'use client';

import type { ReactNode } from 'react';
import { InlineAlert } from '@techma/ui';
import type { Permission } from '@/lib/admin/console-types';
import { useConsole } from './console-context';

/** Renders `children` once the profile is loaded and grants `permission`; a short notice otherwise. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { profile, can } = useConsole();
  if (!profile) return null;
  if (!can(permission)) return <InlineAlert>Vous n’avez pas accès à cette page.</InlineAlert>;
  return <>{children}</>;
}
