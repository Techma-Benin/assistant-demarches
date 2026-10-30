import { Bot, FileText, History, LayoutDashboard, MessagesSquare, Plug } from 'lucide-react';

export type BadgeKey = 'draftProcedures' | 'disabledTools';

export const NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: BadgeKey;
}> = [
  { href: '/', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { href: '/procedures', label: 'Fiches', icon: FileText, badge: 'draftProcedures' },
  { href: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { href: '/tools', label: 'Connexions MCP', icon: Plug, badge: 'disabledTools' },
  { href: '/models', label: 'Modèle IA', icon: Bot },
  { href: '/audit', label: 'Journal d’audit', icon: History },
];

export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
