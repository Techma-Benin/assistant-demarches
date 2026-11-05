'use client';

import { BrandMark, Tooltip, cn } from '@techma/ui';
import { Activity, ChevronsLeft, ChevronsRight, Cpu, Plug, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { OperatorAccountMenu } from './operator-account-menu';
import { OperatorLogomark } from './operator-logomark';

export const OPERATOR_NAV_COLLAPSED_KEY = 'operator-nav-collapsed';

const NAV: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/operateur', label: 'Statut', icon: Activity },
  { href: '/operateur/modeles', label: 'Modèles', icon: Cpu },
  { href: '/operateur/mcp', label: 'Connexions', icon: Plug },
];

const NAV_DRAWER_MS = 220;

function isActive(href: string, pathname: string): boolean {
  return href === '/operateur' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function navActiveIndex(pathname: string): number {
  const index = NAV.findIndex(({ href }) => isActive(href, pathname));
  return index >= 0 ? index : 0;
}

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(OPERATOR_NAV_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} fill="none" />;
}

/** Inverse corners: rail scoops around a canvas hole, same treatment as the administration nav. */
function NavActiveNotch() {
  return (
    <>
      <span className="absolute inset-0 rounded-none bg-canvas" />
      <span data-nav-active-bar="" className="absolute inset-y-0 left-0 w-0.5 rounded-none bg-ink-subtle" />
      <span data-nav-corner="top" className="absolute right-0 bottom-[calc(100%-1px)] h-[17px] w-4 bg-canvas">
        <span className="absolute top-0 right-0 size-4 rounded-br-full bg-shell-rail" />
      </span>
      <span data-nav-corner="bottom" className="absolute top-[calc(100%-1px)] right-0 h-[17px] w-4 bg-canvas">
        <span className="absolute right-0 bottom-0 size-4 rounded-tr-full bg-shell-rail" />
      </span>
    </>
  );
}

export function OperatorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeIndex = navActiveIndex(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [indicatorTransition, setIndicatorTransition] = useState(true);
  const [navMetrics, setNavMetrics] = useState<{ height: number; step: number } | null>(null);
  const navTrackRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const syncNavMetrics = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const firstItem = list.querySelector('li');
    if (!firstItem) return;
    const height = firstItem.getBoundingClientRect().height;
    if (height <= 0) return;
    const gap = Number.parseFloat(getComputedStyle(list).rowGap || getComputedStyle(list).gap) || 0;
    const step = height + gap;
    setNavMetrics((prev) => (prev?.height === height && prev.step === step ? prev : { height, step }));
  }, []);

  useEffect(() => {
    setCollapsed(readStoredCollapsed());
  }, []);

  useLayoutEffect(() => {
    syncNavMetrics();
  }, [pathname, syncNavMetrics]);

  useEffect(() => {
    setIndicatorTransition(false);
    const afterDrawer = window.setTimeout(() => {
      syncNavMetrics();
      setIndicatorTransition(true);
    }, NAV_DRAWER_MS);
    return () => window.clearTimeout(afterDrawer);
  }, [collapsed, syncNavMetrics]);

  useEffect(() => {
    const onResize = () => syncNavMetrics();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [syncNavMetrics]);

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

  const navTrackStyle = {
    '--nav-active-index': activeIndex,
    ...(navMetrics
      ? {
          '--nav-item-height': `${navMetrics.height}px`,
          '--nav-item-step': `${navMetrics.step}px`,
        }
      : {}),
  } as CSSProperties;

  const collapseToggle = collapsed ? (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-expanded={false}
      aria-label="Déplier le menu latéral"
      className="group hidden size-9 shrink-0 cursor-pointer place-items-center rounded-none text-ink-muted transition-colors duration-(--ui-dur-press) hover:bg-sunken hover:text-ink focus-visible:bg-sunken focus-visible:text-ink md:grid"
    >
      <OperatorLogomark className="col-start-1 row-start-1 transition-opacity duration-(--ui-dur-press) group-hover:opacity-0 group-focus:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none" />
      <ChevronsRight
        aria-hidden="true"
        strokeWidth={2}
        className="col-start-1 row-start-1 size-4 opacity-0 transition-opacity duration-(--ui-dur-press) group-hover:opacity-100 group-focus:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
      />
    </button>
  ) : (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-expanded
      aria-label="Replier le menu latéral"
      className="hidden size-9 shrink-0 cursor-pointer items-center justify-center rounded-none text-ink-muted transition-colors duration-(--ui-dur-press) hover:bg-sunken hover:text-ink md:inline-flex"
    >
      <ChevronsLeft aria-hidden="true" className="size-4" strokeWidth={2} />
    </button>
  );

  return (
    <div
      data-collapsed={collapsed ? '' : undefined}
      className={cn(
        'min-h-dvh md:grid md:transition-[grid-template-columns] md:duration-[220ms] md:ease-(--ui-ease-drawer)',
        collapsed ? 'md:grid-cols-[4.25rem_minmax(0,1fr)]' : 'md:grid-cols-[12.5rem_minmax(0,1fr)]',
      )}
    >
      <aside className="bg-shell-rail md:sticky md:top-0 md:h-dvh">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3 md:flex md:h-full md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-0 md:p-0">
          <div
            className={cn(
              'flex w-full shrink-0 items-center justify-between gap-2 px-3 pt-3 md:gap-1.5 md:px-2 md:pt-3',
              collapsed && 'md:flex-col md:items-center md:gap-2 md:px-0 md:pb-1',
            )}
          >
            {collapsed ? (
              <>
                <span className="md:hidden">
                  <OperatorLogomark />
                </span>
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
            className="order-last w-full md:order-none md:w-full md:flex-none md:pt-4"
          >
            <div
              ref={navTrackRef}
              data-operator-nav-track=""
              data-nav-active-index={activeIndex}
              style={navTrackStyle}
              className="relative w-full overflow-visible max-md:px-3 max-md:pt-2"
            >
              <div
                aria-hidden="true"
                data-nav-indicator=""
                className={cn(
                  'pointer-events-none absolute inset-x-0 z-0 hidden overflow-visible md:block motion-reduce:transition-none',
                  indicatorTransition && 'transition-[transform,height] duration-[220ms] ease-(--ui-ease-drawer)',
                )}
                style={{
                  height: 'var(--nav-item-height, 0px)',
                  transform: 'translateY(calc(var(--nav-active-index, 0) * var(--nav-item-step, 0px)))',
                }}
              >
                <NavActiveNotch />
              </div>
              <ul ref={listRef} className="relative z-10 flex gap-1 md:flex-col md:gap-1">
                {NAV.map(({ href, label, icon }) => {
                  const active = isActive(href, pathname);
                  const link = (
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      data-nav-active={active ? 'true' : undefined}
                      className={cn(
                        'flex min-h-12 w-full items-center justify-center gap-2 rounded-none px-2 py-3 text-[15px] font-semibold transition-colors duration-(--ui-dur-press)',
                        collapsed
                          ? 'md:h-[51px] md:min-h-[51px] md:w-full md:min-w-0 md:justify-center md:px-0 md:py-3.5'
                          : 'md:h-16 md:min-h-16 md:justify-start md:gap-2.5 md:px-2.5 md:py-2',
                        active
                          ? 'text-ink max-md:bg-canvas md:bg-transparent'
                          : 'text-ink-muted hover:bg-sunken/80 hover:text-ink dark:hover:bg-sunken/60',
                      )}
                    >
                      <NavIcon icon={icon} />
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
                    <li
                      key={href}
                      className="flex-1 md:flex-none md:w-full"
                    >
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

          <div className="w-full px-2 pt-2 pb-3 md:mt-auto">
            <OperatorAccountMenu collapsed={collapsed} />
          </div>
        </div>
      </aside>
      <main className="min-w-0 w-full px-4 py-6 md:px-8 md:py-8 xl:px-10">{children}</main>
    </div>
  );
}
