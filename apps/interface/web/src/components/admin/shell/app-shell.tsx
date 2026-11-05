'use client';

import { BrandMark, Button, FlagGlyph, IconButton, InlineAlert, Tooltip, cn } from '@techma/ui';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { adminApi, type CaseStatus } from '@/lib/admin/api';
import { useConsole } from '../console/console-context';
import { AccountMenu } from './account-menu';
import { ActiveCaseStatusProvider } from './active-case-status';
import { RAIL_CONTENT_CLASS, RailEdgeShadow, RailGrip, railFrameClass, useSharedRailWidth } from '@/components/shell/rail-resize';
import { BUSINESS_NAV, PROFILE_NAV, USERS_NAV, isActive, type NavItem } from './nav-items';

const DESKTOP_QUERY = '(min-width: 768px)';
const NAV_COLLAPSED_KEY = 'admin-nav-collapsed';
const NAV_DRAWER_MS = 220;

function subscribeDesktop(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const isDesktop = () => typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Number of cases waiting (`dashboard.metrics.pending`) for the administration; null when unknown. Refreshed on navigation. */
function usePendingCount(enabled: boolean, scopeId: string | undefined, refreshKey: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    const controller = new AbortController();
    adminApi.getDashboard({ administrationId: scopeId }, controller.signal).then(
      (dashboard) => setCount(dashboard.metrics.pending),
      () => !controller.signal.aborted && setCount(null),
    );
    return () => controller.abort();
  }, [enabled, scopeId, refreshKey]);
  return count;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [indicatorTransition, setIndicatorTransition] = useState(true);
  const [navMetrics, setNavMetrics] = useState<{ height: number; step: number } | null>(null);
  const [trackTop, setTrackTop] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const { profile, administrationId, scopeId, isSuperAdmin, can, loading, error, reload } = useConsole();
  const [caseStatus, setCaseStatus] = useState<CaseStatus | null>(null);
  const canReadCases = can('cases:read');
  const pending = usePendingCount(canReadCases && (!isSuperAdmin || scopeId !== undefined), scopeId, pathname);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => setCollapsed(readCollapsed()), []);

  const businessItems = [...BUSINESS_NAV, USERS_NAV, PROFILE_NAV].filter((item) => !item.permission || can(item.permission));
  const activeIndex = businessItems.findIndex((item) => isActive(item, pathname, caseStatus));

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

  useLayoutEffect(() => {
    syncNavMetrics();
  }, [pathname, businessItems.length, syncNavMetrics]);

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
      if (next) window.localStorage.setItem(NAV_COLLAPSED_KEY, 'true');
      else window.localStorage.removeItem(NAV_COLLAPSED_KEY);
    } catch {
      // Storage unavailable: the choice only lasts for this page.
    }
  }, []);
  const rail = useSharedRailWidth(collapsed, commitCollapsed);

  const navVars = {
    '--nav-active-index': Math.max(activeIndex, 0),
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
    <ActiveCaseStatusProvider onStatus={setCaseStatus}>
      <div
        ref={shellRef}
        data-collapsed={collapsed ? '' : undefined}
        style={{ '--rail-width': rail.column, ...navVars } as CSSProperties}
        className={railFrameClass(rail.dragging)}
      >
      <aside className="relative bg-shell-rail md:sticky md:top-0 md:h-dvh">
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
                  <BrandMark />
                </span>
                <FlagGlyph decorative width={28} height={21} className="hidden shrink-0 md:inline-block" />
              </>
            ) : (
              <div className="min-w-0 flex-1">
                <BrandMark />
              </div>
            )}
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
              'absolute inset-x-0 top-full z-20 flex max-h-[calc(100dvh-3.5rem)] w-full flex-col overflow-y-auto bg-shell-rail transition-[opacity,translate,visibility] ease-(--ui-ease-out) motion-reduce:translate-y-0',
              'md:pointer-events-auto md:visible md:static md:z-auto md:max-h-none md:min-h-0 md:flex-1 md:translate-y-0 md:overflow-visible md:bg-transparent md:opacity-100 md:transition-none',
              open
                ? 'visible translate-y-0 opacity-100 duration-220'
                : 'pointer-events-none invisible -translate-y-2 opacity-0 duration-(--ui-dur-exit)',
            )}
          >
            <nav aria-label="Navigation principale" className="w-full md:pt-4">
              <div
                data-admin-nav-track=""
                data-nav-active-index={activeIndex}
                style={navTrackStyle}
                className="relative w-full overflow-visible max-md:px-3 max-md:pt-2"
              >
                {activeIndex >= 0 ? (
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
                ) : null}
                <ul ref={listRef} className="relative z-10 flex flex-col gap-1">
                  {businessItems.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      caseStatus={caseStatus}
                      count={item.pendingBadge ? pending : null}
                      collapsed={collapsed}
                    />
                  ))}
                </ul>
              </div>
            </nav>
            <div className="mt-auto px-2 pt-2 pb-3 md:mt-auto md:px-2 md:pb-3">
              <AccountMenu collapsed={collapsed} />
            </div>
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
      <RailEdgeShadow cutout={!collapsed && activeIndex >= 0 && trackTop != null} />
      <main className={RAIL_CONTENT_CLASS}>
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
          <div key={`${pathname}|${administrationId}`} className="ui-rise">
            {children}
          </div>
        )}
      </main>
      </div>
    </ActiveCaseStatusProvider>
  );
}

/** Inverse corners: rail scoops around a canvas hole. White square overlaps the block 1px; the 16px rail radius sits on the block edge. */
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

function NavLink({
  item,
  pathname,
  caseStatus,
  count,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  caseStatus: CaseStatus | null;
  count?: number | null;
  collapsed: boolean;
}) {
  const { href, label, icon: Icon } = item;
  const active = isActive(item, pathname, caseStatus);
  const link = (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={count ? `${label}, ${count} à traiter` : undefined}
      data-nav-active={active ? 'true' : undefined}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 rounded-none px-3 py-3 text-[15px] font-semibold transition-colors duration-(--ui-dur-press)',
        collapsed
          ? 'md:h-[51px] md:min-h-[51px] md:justify-center md:px-0 md:py-3.5'
          : 'md:h-16 md:min-h-16 md:gap-2.5 md:px-2.5 md:py-2',
        active ? 'text-ink max-md:bg-canvas md:bg-transparent' : 'text-ink-muted hover:bg-sunken/80 hover:text-ink dark:hover:bg-sunken/60',
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} fill="none" />
      <span
        className={cn(
          'min-w-0 flex-1 truncate transition-opacity duration-[220ms] ease-(--ui-ease-drawer)',
          collapsed && 'md:sr-only md:w-0 md:flex-none md:overflow-hidden md:opacity-0',
        )}
      >
        {label}
      </span>
      {count ? (
        <span
          className={cn(
            'font-semibold tabular-nums',
            collapsed
              ? 'max-md:inline-flex max-md:h-5 max-md:min-w-5 max-md:shrink-0 max-md:items-center max-md:justify-center max-md:rounded-full max-md:bg-warning-pending max-md:px-1 max-md:text-xs max-md:leading-none max-md:text-white md:sr-only'
              : 'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-warning-pending px-1 text-xs leading-none text-white',
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );

  return (
    <li className="w-full">
      {collapsed ? (
        <Tooltip label={count ? `${label}, ${count}` : label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}
