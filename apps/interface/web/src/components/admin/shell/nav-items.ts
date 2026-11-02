import {
  CircleCheck,
  History,
  Inbox,
  LayoutDashboard,
  MessageCircleQuestion,
  UserRound,
  Users,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** The pending count of work items is shown on this entry. */
  pendingBadge?: boolean;
  /** Extra path prefixes that keep the entry highlighted (e.g. a dossier detail). */
  alsoActiveOn?: readonly string[];
}

export const BUSINESS_NAV: readonly NavItem[] = [
  { href: '/admin', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { href: '/admin/a-verifier', label: 'À vérifier', icon: Inbox, pendingBadge: true, alsoActiveOn: ['/admin/dossiers'] },
  { href: '/admin/complete', label: 'Complété', icon: CircleCheck },
  { href: '/admin/sans-reponse', label: 'Sans réponse', icon: MessageCircleQuestion },
  { href: '/admin/journal', label: 'Journal d’audit', icon: History },
];

export const USERS_NAV: NavItem = { href: '/admin/utilisateurs', label: 'Utilisateurs', icon: Users };
export const PROFILE_NAV: NavItem = { href: '/admin/profil', label: 'Profil', icon: UserRound };

export function isActive({ href, alsoActiveOn = [] }: NavItem, pathname: string): boolean {
  const matches = (prefix: string) => (prefix === '/admin' ? pathname === '/admin' : pathname === prefix || pathname.startsWith(`${prefix}/`));
  return matches(href) || alsoActiveOn.some(matches);
}
