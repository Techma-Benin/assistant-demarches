'use client';

import { BrandMark, Tooltip, cn } from '@techma/ui';
import { Activity, Cpu, Plug, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NavActiveNotch, RAIL_CONTENT_CLASS, RailCollapseControl, RailEdgeShadow, RailGrip, railFrameClass, useSharedRailWidth } from '@/components/shell/rail-resize';
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

export function OperatorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeIndex = navActiveIndex(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [indicatorTransition, setIndicatorTransition] = useState(true);
  const [navMetrics, setNavMetrics] = useState<{ height: number; step: number } | null>(null);
  const [trackTop, setTrackTop] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const navTrackRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const syncNavMetrics = useCallback(() => {
    const list = listRef.current;
    const shell = shellRef.current;
    if (!list) return;
    const firstItem = list.querySelector('li');
    if (!firstItem) return;
    if (shell) {
      const top = Math.round(firstItem.getBoundingClientRect().top - shell.getBoundingClientRect().top);
      setTrackTop((prev) => (prev === top ? prev : top));
    }
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

  const commitCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      if (next) window.localStorage.setItem(OPERATOR_NAV_COLLAPSED_KEY, 'true');
      else window.localStorage.removeItem(OPERATOR_NAV_COLLAPSED_KEY);
    } catch {
      // ignore
    }
  }, []);
  const rail = useSharedRailWidth(collapsed, commitCollapsed);

  const navVars = {
    '--nav-active-index': activeIndex,
    ...(trackTop != null ? { '--nav-track-top': `${trackTop}px` } : {}),
    ...(navMetrics
      ? {
          '--nav-item-height': `${navMetrics.height}px`,
          '--nav-item-step': `${navMetrics.step}px`,
        }
      : {}),
    '--rail-cut-top': 'calc(var(--nav-track-top, 0px) + var(--nav-active-index, 0) * var(--nav-item-step, 0px))',
  } as CSSProperties;

  const navTrackStyle = navVars;

  return (
    <div
      ref={shellRef}
      data-collapsed={collapsed ? '' : undefined}
      style={{ '--rail-width': rail.column, ...navVars } as CSSProperties}
      className={railFrameClass(rail.dragging)}
    >
      <aside className="surface-glass md:sticky md:top-0 md:h-dvh">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-3 md:flex md:h-full md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-0 md:p-0">
          <div
            className={cn(
              'flex w-full shrink-0 items-center justify-between gap-2 px-3 pt-3 md:gap-1.5 md:px-2 md:pt-3',
              collapsed && 'md:flex-col md:items-center md:gap-2 md:px-0 md:pb-1',
            )}
          >
            {collapsed ? (
              <span className="md:hidden">
                <OperatorLogomark />
              </span>
            ) : (
              <div className="min-w-0 flex-1">
                <BrandMark />
                <p className="mt-1 text-xs leading-tight font-semibold text-ink-muted">Console opérateur</p>
              </div>
            )}
            <RailCollapseControl
              collapsed={collapsed}
              onToggle={() => commitCollapsed(!collapsed)}
              mark={<OperatorLogomark />}
            />
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
                  'pointer-events-none absolute inset-x-0 z-[1] hidden overflow-visible md:block motion-reduce:transition-none',
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
        <RailGrip
          collapsed={collapsed}
          width={rail.width}
          max={rail.max}
          onProposed={rail.applyProposed}
          onNudge={rail.nudge}
          onDraggingChange={rail.setDragging}
        />
      </aside>
      <RailEdgeShadow cutout={trackTop != null} />
      <main className={RAIL_CONTENT_CLASS}>{children}</main>
    </div>
  );
}
