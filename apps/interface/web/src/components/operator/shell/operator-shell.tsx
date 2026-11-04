'use client';

import { BrandMark, Button, ThemeToggle, cn } from '@techma/ui';
import { Activity, Cpu, LogOut, Plug, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/operateur', label: 'Statut', icon: Activity },
  { href: '/operateur/modeles', label: 'Modèles', icon: Cpu },
  { href: '/operateur/mcp', label: 'Connexions', icon: Plug },
];

function isActive(href: string, pathname: string): boolean {
  return href === '/operateur' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function OperatorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-line-subtle bg-shell md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3 md:h-full md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-6 md:p-4 md:pt-6">
          <div className="px-1 md:px-2">
            <BrandMark />
            <p className="mt-1 text-xs leading-tight font-semibold text-ink-muted">Console opérateur</p>
          </div>
          <nav aria-label="Navigation principale" className="order-last w-full md:order-none md:flex-1">
            <ul className="flex gap-1 md:flex-col">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = isActive(href, pathname);
                return (
                  <li key={href} className="flex-1 md:flex-none">
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-2 rounded-field px-2 text-[15px] font-semibold transition-colors duration-(--ui-dur-press) md:justify-start md:gap-3 md:px-3',
                        active ? 'bg-action text-on-action' : 'text-ink-muted hover:bg-sunken hover:text-ink',
                      )}
                    >
                      <Icon aria-hidden="true" className="size-5 shrink-0" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex items-center gap-1 md:justify-between md:border-t md:border-line-subtle md:pt-3">
            <form method="post" action="/auth/logout">
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                leadingIcon={<LogOut aria-hidden="true" className="size-4" />}
                className="max-md:size-11 max-md:px-0"
              >
                <span className="max-md:sr-only">Se déconnecter</span>
              </Button>
            </form>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-10 md:py-10">{children}</main>
    </div>
  );
}
