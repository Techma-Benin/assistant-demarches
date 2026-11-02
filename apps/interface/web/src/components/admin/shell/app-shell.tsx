'use client';

import { BrandMark, Button, IconButton, InlineAlert, ThemeToggle, cn } from '@techma/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { canManageUsers } from '@/lib/admin/permissions';
import { newTraceparent } from '@/lib/trace';
import { useConsole } from '../console/console-context';
import { MinistrySelector } from './ministry-selector';
import { BUSINESS_NAV, PROFILE_NAV, USERS_NAV, isActive, type NavItem } from './nav-items';
import { ServiceStatusTile } from './service-status-tile';

const DESKTOP_QUERY = '(min-width: 768px)';

function subscribeDesktop(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const isDesktop = () => typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;

/** Number of items waiting for a decision in the selected ministry; null when unknown. One request, refreshed on navigation. */
function usePendingCount(departmentId: string | null, refreshKey: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!departmentId) {
      setCount(null);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ departmentId, status: 'pending', limit: '100' });
    fetch(`/api/admin/v1/admin/work-items?${query}`, {
      headers: { traceparent: newTraceparent() },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('http'))))
      .then(
        (page: { items: unknown[] }) => setCount(page.items.length),
        () => !controller.signal.aborted && setCount(null),
      );
    return () => controller.abort();
  }, [departmentId, refreshKey]);
  return count;
}

function NavLink({ item, pathname, count }: { item: NavItem; pathname: string; count?: number | null }) {
  const { href, label, icon: Icon } = item;
  const active = isActive(item, pathname);
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        aria-label={count ? `${label}, ${count} à traiter` : undefined}
        className={cn(
          'flex min-h-[46px] items-center gap-3 rounded-[14px] px-3 text-[15px] font-semibold transition-[color,background-color,transform] duration-(--ui-dur-fast) ease-(--ui-ease-out) active:scale-[0.98] motion-reduce:active:scale-100',
          active ? 'bg-action text-on-action' : 'text-ink-muted hover:bg-sunken hover:text-ink',
        )}
      >
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        <span className="flex-1">{label}</span>
        {count ? <span className="rounded-pill bg-sun px-2 py-0.5 text-xs font-extrabold text-warning">{count}</span> : null}
      </Link>
    </li>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const { profile, departmentId, loading, error, reload } = useConsole();
  const pending = usePendingCount(departmentId, pathname);

  // Close the mobile menu after navigating.
  useEffect(() => setOpen(false), [pathname]);

  const businessItems = [...BUSINESS_NAV, ...(canManageUsers(profile, departmentId) ? [USERS_NAV] : []), PROFILE_NAV];
  const backend = error ? 'down' : loading && !profile ? 'checking' : 'up';

  return (
    <div className="min-h-dvh md:flex">
      <aside className="relative border-b border-line-subtle bg-shell md:sticky md:top-0 md:flex md:h-dvh md:w-62 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 md:px-6 md:pt-6 md:pb-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <BrandMark />
              <p className="mt-1 text-xs leading-tight font-semibold text-ink-muted">Console d’administration</p>
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
        <div
          id="console-nav"
          inert={!open && !desktop}
          className={cn(
            // Mobile: overlay panel kept mounted; desktop: static column (visible overflow so the menus can exceed the sidebar width).
            'absolute inset-x-0 top-full z-20 flex max-h-[calc(100dvh-3.5rem)] flex-col overflow-y-auto border-b border-line-subtle bg-shell transition-[opacity,translate,visibility] ease-(--ui-ease-out) motion-reduce:translate-y-0',
            'md:pointer-events-auto md:visible md:static md:z-auto md:max-h-none md:min-h-0 md:flex-1 md:translate-y-0 md:overflow-visible md:border-b-0 md:bg-transparent md:opacity-100 md:transition-none',
            open
              ? 'visible translate-y-0 opacity-100 duration-220'
              : 'pointer-events-none invisible -translate-y-2 opacity-0 duration-(--ui-dur-exit)',
          )}
        >
          <div className="flex flex-col gap-3 px-4 pb-4">
            <MinistrySelector />
          </div>
          <nav aria-label="Navigation principale" className="px-4 pb-3 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <ul className="flex flex-col gap-1">
              {businessItems.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} count={item.pendingBadge ? pending : null} />
              ))}
            </ul>
          </nav>
          <div className="flex flex-col gap-3 px-4 py-4">
            <ServiceStatusTile state={backend} />
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        {error ? (
          <div className="flex max-w-xl flex-col items-start gap-4">
            <InlineAlert>{error}</InlineAlert>
            <Button variant="outline" onClick={reload}>
              Réessayer
            </Button>
          </div>
        ) : loading && !profile ? (
          <p role="status" className="text-sm font-semibold text-ink-muted">
            Chargement…
          </p>
        ) : (
          // Remounted on every ministry change so pages reload their data.
          <div key={`${pathname}|${departmentId}`} className="ui-rise">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
