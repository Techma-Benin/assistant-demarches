import { Bot, FileText, Gauge, History, MessagesSquare, Wrench } from 'lucide-react';

export const NAV_ITEMS = [
  { href: '/', label: 'Tableau de bord', icon: Gauge },
  { href: '/procedures', label: 'Fiches de démarche', icon: FileText },
  { href: '/models', label: 'Modèles', icon: Bot },
  { href: '/tools', label: 'Outils', icon: Wrench },
  { href: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { href: '/audit', label: 'Journal d’audit', icon: History },
] as const;

export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
