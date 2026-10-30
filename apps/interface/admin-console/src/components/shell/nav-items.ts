import {
  Bot,
  CircleCheck,
  FileText,
  History,
  Inbox,
  LayoutDashboard,
  MessageCircleQuestion,
  MessagesSquare,
  Plug,
  ScrollText,
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
  { href: '/', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { href: '/a-verifier', label: 'À vérifier', icon: Inbox, pendingBadge: true, alsoActiveOn: ['/dossiers'] },
  { href: '/complete', label: 'Complété', icon: CircleCheck },
  { href: '/sans-reponse', label: 'Sans réponse', icon: MessageCircleQuestion },
  { href: '/journal', label: 'Journal d’audit', icon: History },
];

export const USERS_NAV: NavItem = { href: '/utilisateurs', label: 'Utilisateurs', icon: Users };
export const PROFILE_NAV: NavItem = { href: '/profil', label: 'Profil', icon: UserRound };

/** Configuration screens, shown only to holders of an operator permission. */
export const OPERATOR_NAV: readonly NavItem[] = [
  { href: '/procedures', label: 'Fiches', icon: FileText },
  { href: '/models', label: 'Modèle IA', icon: Bot },
  { href: '/tools', label: 'Connexions MCP', icon: Plug },
  { href: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { href: '/audit', label: 'Audit technique', icon: ScrollText },
];

export function isActive({ href, alsoActiveOn = [] }: NavItem, pathname: string): boolean {
  const matches = (prefix: string) => (prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`));
  return matches(href) || alsoActiveOn.some(matches);
}
