'use client';

import { BrandMark, Button, ThemeToggle, cn } from '@techma/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/operateur', label: 'Modèles' },
  { href: '/operateur/mcp', label: 'Connexions MCP' },
  { href: '/operateur/etat', label: 'État' },
] as const;

function isActive(href: string, pathname: string): boolean {
  if (href === '/operateur') return pathname === '/operateur' || pathname.startsWith('/operateur/modeles');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function OperatorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line-subtle bg-shell">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 md:px-8">
          <div>
            <BrandMark />
            <p className="mt-1 text-xs leading-tight font-semibold text-ink-muted">Console opérateur</p>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <form method="post" action="/auth/logout">
              <Button type="submit" variant="outline" size="sm">
                Se déconnecter
              </Button>
            </form>
          </div>
          <nav aria-label="Navigation principale" className="w-full">
            <ul className="flex flex-wrap gap-1">
              {NAV.map((item) => {
                const active = isActive(item.href, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center rounded-[14px] px-4 text-[15px] font-semibold transition-colors',
                        active ? 'bg-action text-on-action' : 'text-ink-muted hover:bg-sunken hover:text-ink',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
