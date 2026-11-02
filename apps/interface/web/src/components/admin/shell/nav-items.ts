import {
  Ban,
  CircleCheck,
  History,
  Inbox,
  LayoutDashboard,
  MessageCircleQuestion,
  UserRound,
  Users,
} from 'lucide-react';
import type { Permission } from '@/lib/admin/console-types';

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
    alsoActiveOn: ['/admin/dossiers'],
    permission: 'cases:read',
  },
  { href: '/admin/complete', label: 'Complété', icon: CircleCheck, permission: 'cases:read' },
  { href: '/admin/rejete', label: 'Rejeté', icon: Ban, permission: 'cases:read' },
  { href: '/admin/sans-reponse', label: 'Sans réponse', icon: MessageCircleQuestion },
  { href: '/admin/journal', label: 'Journal', icon: History },
];

export const USERS_NAV: NavItem = {
  href: '/admin/utilisateurs',
  label: 'Utilisateurs',
  icon: Users,
  permission: 'officials:read',
};
export const PROFILE_NAV: NavItem = { href: '/admin/profil', label: 'Profil', icon: UserRound };

export function isActive({ href, alsoActiveOn = [] }: NavItem, pathname: string): boolean {
  const matches = (prefix: string) => (prefix === '/admin' ? pathname === '/admin' : pathname === prefix || pathname.startsWith(`${prefix}/`));
  return matches(href) || alsoActiveOn.some(matches);
}
