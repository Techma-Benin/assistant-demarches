'use client';

import { BrandMark, Button, THEME_STORAGE_KEY, Tooltip, cn } from '@techma/ui';
import { Activity, ChevronsLeft, ChevronsRight, Cpu, LogOut, Monitor, Moon, Plug, Sun, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { OperatorLogomark } from './operator-logomark';

export const OPERATOR_NAV_COLLAPSED_KEY = 'operator-nav-collapsed';

const NAV: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/operateur', label: 'Statut', icon: Activity },
  { href: '/operateur/modeles', label: 'Modèles', icon: Cpu },
  { href: '/operateur/mcp', label: 'Connexions', icon: Plug },
];

type ThemePreference = 'system' | 'light' | 'dark';
const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Thème : système',
  light: 'Thème : clair',
  dark: 'Thème : sombre',
};
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

function isActive(href: string, pathname: string): boolean {
  return href === '/operateur' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function readStoredTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(OPERATOR_NAV_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function NavIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <Icon
      aria-hidden="true"
      className="size-5 shrink-0"
      strokeWidth={active ? 0 : 1.75}
      fill={active ? 'currentColor' : 'none'}
    />
  );
}

function ShellThemeControl({ collapsed }: { collapsed: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => setPreference(readStoredTheme()), []);

  function cycle() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length];
    setPreference(next);
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice only lasts for this page.
    }
  }

  const Icon = THEME_ICONS[preference];
  const control = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={collapsed ? THEME_LABELS[preference] : undefined}
      onClick={cycle}
      leadingIcon={<Icon key={preference} aria-hidden="true" className="ui-swap ui-theme-icon size-5 shrink-0" />}
      className={cn(
        'min-h-10 w-full justify-start gap-3 rounded-none px-3 text-[15px] font-semibold text-ink-muted hover:bg-sunken hover:text-ink',
        collapsed && 'md:justify-center md:px-0',
      )}
    >
      <span className={cn('transition-opacity duration-[220ms] ease-(--ui-ease-drawer)', collapsed && 'md:sr-only')}>
        Thème
      </span>
    </Button>
  );

  if (!collapsed) return control;
  return (
    <Tooltip label={THEME_LABELS[preference]} side="right">
      {control}
    </Tooltip>
  );
}

function ShellLogoutControl({ collapsed }: { collapsed: boolean }) {
  const button = (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      leadingIcon={<LogOut aria-hidden="true" className="size-5 shrink-0" />}
      className={cn(
        'min-h-10 w-full justify-start gap-3 rounded-none px-3 text-[15px] font-semibold text-ink-muted hover:bg-sunken hover:text-ink',
        collapsed && 'md:justify-center md:px-0',
      )}
    >
      <span className={cn('transition-opacity duration-[220ms] ease-(--ui-ease-drawer)', collapsed && 'md:sr-only')}>
        Se déconnecter
      </span>
    </Button>
  );

  return (
    <form method="post" action="/auth/logout" className="w-full">
      {collapsed ? (
        <Tooltip label="Se déconnecter" side="right">
          {button}
        </Tooltip>
      ) : (
        button
      )}
    </form>
  );
}

export function OperatorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0, visible: false });

  useEffect(() => {
    setCollapsed(readStoredCollapsed());
  }, []);

  const measureIndicator = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.querySelector<HTMLElement>('[data-nav-active="true"]');
    if (!activeEl) {
      setIndicator((prev) => ({ ...prev, visible: false }));
      return;
    }
    const listRect = list.getBoundingClientRect();
    const itemRect = activeEl.getBoundingClientRect();
    setIndicator({
      top: itemRect.top - listRect.top,
      height: itemRect.height,
      visible: true,
    });
  }, []);

  useLayoutEffect(() => {
    measureIndicator();
  }, [pathname, collapsed, measureIndicator]);

  useEffect(() => {
    window.addEventListener('resize', measureIndicator);
    return () => window.removeEventListener('resize', measureIndicator);
  }, [measureIndicator]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (next) window.localStorage.setItem(OPERATOR_NAV_COLLAPSED_KEY, 'true');
        else window.localStorage.removeItem(OPERATOR_NAV_COLLAPSED_KEY);
      } catch {
        // ignore
      }
      return next;
    });
  }

  const collapseToggle = (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Déplier le menu latéral' : 'Replier le menu latéral'}
      className="hidden size-9 shrink-0 cursor-pointer items-center justify-center rounded-none text-ink-muted transition-colors duration-(--ui-dur-press) hover:bg-sunken hover:text-ink md:inline-flex"
    >
      {collapsed ? (
        <ChevronsRight aria-hidden="true" className="size-4" strokeWidth={2} />
      ) : (
        <ChevronsLeft aria-hidden="true" className="size-4" strokeWidth={2} />
      )}
    </button>
  );

  return (
    <div
      className={cn(
        'min-h-dvh md:grid md:transition-[grid-template-columns] md:duration-[220ms] md:ease-(--ui-ease-drawer)',
        collapsed ? 'md:grid-cols-[4.25rem_minmax(0,1fr)]' : 'md:grid-cols-[15rem_minmax(0,1fr)]',
      )}
    >
      <aside className="border-b border-line-subtle bg-shell md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3 md:flex md:h-full md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-0 md:p-0">
          <div
            className={cn(
              'flex w-full shrink-0 items-center justify-between gap-2 px-3 pt-3 md:pt-4',
              collapsed && 'md:flex-col md:items-center md:gap-2 md:px-0 md:pb-1',
            )}
          >
            {collapsed ? (
              <>
                <OperatorLogomark />
                {collapseToggle}
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <BrandMark />
                  <p className="mt-1 text-xs leading-tight font-semibold text-ink-muted">Console opérateur</p>
                </div>
                {collapseToggle}
              </>
            )}
          </div>

          <nav
            aria-label="Navigation principale"
            className="order-last w-full md:order-none md:w-full md:flex-none md:pt-1"
          >
            <div className="relative w-full max-md:border-t max-md:border-line-subtle max-md:px-3 max-md:pt-2">
              <div
                aria-hidden="true"
                data-nav-indicator=""
                className={cn(
                  'pointer-events-none absolute inset-x-0 z-0 hidden md:block motion-reduce:transition-none',
                  'transition-[transform,height,opacity] duration-[220ms] ease-(--ui-ease-drawer)',
                  indicator.visible ? 'opacity-100' : 'opacity-0',
                )}
                style={{
                  transform: `translateY(${indicator.top}px)`,
                  height: indicator.height || undefined,
                }}
              >
                <span className="absolute inset-y-0 left-0 w-[3px] bg-action" />
                <span className="absolute inset-0 bg-sunken/90 dark:bg-sunken/80" />
              </div>
              <ul ref={listRef} className="relative z-10 flex gap-1 md:flex-col md:gap-0">
                {NAV.map(({ href, label, icon }) => {
                  const active = isActive(href, pathname);
                  const link = (
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      data-nav-active={active ? 'true' : undefined}
                      className={cn(
                        'flex min-h-11 w-full items-center justify-center gap-2 rounded-none px-2 text-[15px] font-semibold transition-colors duration-(--ui-dur-press) md:min-h-10 md:justify-start md:gap-3 md:px-3',
                        active ? 'text-ink max-md:bg-sunken' : 'text-ink-muted hover:bg-sunken hover:text-ink',
                        collapsed && 'md:justify-center md:px-0',
                      )}
                    >
                      <NavIcon icon={icon} active={active} />
                      <span
                        className={cn(
                          'transition-opacity duration-[220ms] ease-(--ui-ease-drawer)',
                          collapsed && 'md:sr-only md:w-0 md:overflow-hidden md:opacity-0',
                        )}
                      >
                        {label}
                      </span>
                    </Link>
                  );

                  return (
                    <li key={href} className="flex-1 md:flex-none md:w-full">
                      {collapsed ? (
                        <Tooltip label={label} side="right">
                          {link}
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>

          <div className="flex w-full items-center gap-1 border-line-subtle px-3 max-md:pb-1 md:mt-auto md:flex-col md:gap-0 md:border-t md:px-0 md:pt-0">
            <ShellLogoutControl collapsed={collapsed} />
            <ShellThemeControl collapsed={collapsed} />
          </div>
        </div>
      </aside>
      <main className="min-w-0 w-full px-4 py-6 md:px-8 md:py-8 xl:px-10">{children}</main>
    </div>
  );
}
