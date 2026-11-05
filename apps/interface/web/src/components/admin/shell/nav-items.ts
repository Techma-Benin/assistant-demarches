import {
  Ban,
  CircleCheck,
  History,
  Inbox,
  LayoutDashboard,
  UserRound,
  Users,
} from 'lucide-react';
import type { CaseStatus } from '@/lib/admin/api';
import type { Permission } from '@/lib/admin/console-types';
import { tabOfStatus } from '@/lib/admin/work-format';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** The pending count (`dashboard.metrics.pending`) is shown on this entry. */
  pendingBadge?: boolean;
  /** Extra path prefixes that keep the entry highlighted (e.g. a dossier detail). */
  alsoActiveOn?: readonly string[];
  /** The entry is hidden unless the profile grants this permission. */
  permission?: Permission;
}

export const BUSINESS_NAV: readonly NavItem[] = [
  { href: '/admin', label: 'Vue d’ensemble', icon: LayoutDashboard },
  {
    href: '/admin/en-attente',
    label: 'En attente',
    icon: Inbox,
    pendingBadge: true,
    permission: 'cases:read',
  },
  { href: '/admin/complete', label: 'Complété', icon: CircleCheck, permission: 'cases:read' },
  { href: '/admin/rejete', label: 'Rejeté', icon: Ban, permission: 'cases:read' },
  { href: '/admin/journal', label: 'Journal', icon: History },
];

export const USERS_NAV: NavItem = {
  href: '/admin/utilisateurs',
  label: 'Utilisateurs',
  icon: Users,
  permission: 'officials:read',
};
export const PROFILE_NAV: NavItem = { href: '/admin/profil', label: 'Profil', icon: UserRound };

const DOSSIER_PREFIX = '/admin/dossiers';

function isDossierPath(pathname: string): boolean {
  return pathname === DOSSIER_PREFIX || pathname.startsWith(`${DOSSIER_PREFIX}/`);
}

/** Queue tab for a dossier: Complété / Rejeté / En attente. Unknown status stays En attente. */
export function dossierNavHref(status: CaseStatus | null | undefined): string {
  if (!status) return '/admin/en-attente';
  return `/admin/${tabOfStatus(status)?.slug ?? 'en-attente'}`;
}

export function isActive({ href, alsoActiveOn = [] }: NavItem, pathname: string, caseStatus?: CaseStatus | null): boolean {
  const matches = (prefix: string) => (prefix === '/admin' ? pathname === '/admin' : pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isDossierPath(pathname)) return href === dossierNavHref(caseStatus);
  return matches(href) || alsoActiveOn.some(matches);
}
