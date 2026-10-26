'use client';

import { Badge, BrandMark, IconButton, ThemeToggle, cn } from '@techma/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NAV_ITEMS, isActive } from './nav-items';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu after navigating.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-dvh md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 md:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <p className="text-sm leading-tight font-extrabold">Console d’administration</p>
              <Badge className="mt-1">Démo</Badge>
            </div>
          </div>
          <IconButton
            label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
            variant="ghost"
            className="md:hidden"
            aria-expanded={open}
            aria-controls="console-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          </IconButton>
        </div>
        <div id="console-nav" className={cn('flex-col md:flex md:flex-1', open ? 'flex' : 'hidden')}>
          <nav aria-label="Navigation principale" className="flex-1 px-3 pb-3">
            <ul className="flex flex-col gap-1">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = isActive(href, pathname);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-field px-3 text-sm font-semibold transition-colors duration-(--ui-dur-fast)',
                        active ? 'bg-sunken text-ink' : 'text-ink-muted hover:bg-sunken hover:text-ink',
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
          <div className="border-t border-line px-3 py-3">
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
