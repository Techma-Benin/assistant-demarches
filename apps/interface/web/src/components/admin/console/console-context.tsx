'use client';

import { InlineAlert, Toast } from '@techma/ui';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { adminApi } from '@/lib/admin/api';
import type { AdminProfile, Administration, Official, Permission } from '@/lib/admin/console-types';
import { can as hasPermission } from '@/lib/admin/permissions';
import { anonymousOfficial } from '@/lib/admin/work-format';
import { newTraceparent } from '@/lib/trace';
import { useToast } from '../use-toast';

export interface ConsoleValue {
  profile: AdminProfile | null;
  official: Official | null;
  /** All administrations for a super admin (`administrations:all`), otherwise the person’s own. */
  administrations: Administration[];
  /** The administration the screens work on (the person’s own, or the super admin’s choice). */
  administrationId: string | null;
  administration: Administration | null;
  isSuperAdmin: boolean;
  /** `administrationId` to send to the API: only a super admin names it, the server forces it for the others. */
  scopeId: string | undefined;
  loading: boolean;
  error: string | null;
  can(permission: Permission): boolean;
  /** Name of an official from `GET /officials` (needs `officials:read`), else « Agent » + short id. */
  officialName(id: string): string;
  selectAdministration(id: string): Promise<void>;
  /** Replaces the signed-in official after a profile edit. */
  setOfficial(official: Official): void;
  reload(): void;
}

const ConsoleContext = createContext<ConsoleValue | null>(null);

const LOAD_FAILED = 'Impossible de charger votre profil. Réessayez.';
const SWITCH_FAILED = 'Impossible de changer d’administration. Réessayez.';
const ERROR_DURATION = 6000;
const MAX_OFFICIAL_PAGES = 5;

export const isConnected = (administration: Administration): boolean =>
  administration.connection.status === 'connected';

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', traceparent: newTraceparent() },
    body: JSON.stringify(body),
  });
}

export function ConsoleProvider({
  initialAdministrationId,
  children,
}: {
  initialAdministrationId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [requestedId, setRequestedId] = useState(initialAdministrationId);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [allAdministrations, setAllAdministrations] = useState<Administration[]>([]);
  const [officialNames, setOfficialNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      const me = await adminApi.me(controller.signal);
      const all = hasPermission(me, 'administrations:all')
        ? (await adminApi.listAdministrations(controller.signal)).items
        : [];
      return { me, all };
    })().then(
      ({ me, all }) => {
        setProfile(me);
        setAllAdministrations(all);
        setLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setProfile(null);
        setAllAdministrations([]);
        setError(LOAD_FAILED);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    if (actionError === null) return;
    const timer = setTimeout(() => setActionError(null), ERROR_DURATION);
    return () => clearTimeout(timer);
  }, [actionError]);

  const isSuperAdmin = hasPermission(profile, 'administrations:all');
  const administrations = useMemo(
    () => (isSuperAdmin ? allAdministrations : profile?.administration ? [profile.administration] : []),
    [isSuperAdmin, allAdministrations, profile],
  );
  const administration = useMemo<Administration | null>(() => {
    if (!isSuperAdmin) return profile?.administration ?? null;
    // Only connected administrations hold data: a stale cookie falls back to the first of them.
    const connected = administrations.filter(isConnected);
    return connected.find((candidate) => candidate.id === requestedId) ?? connected[0] ?? null;
  }, [isSuperAdmin, profile, administrations, requestedId]);
  const administrationId = administration?.id ?? null;
  const scopeId = isSuperAdmin ? (administrationId ?? undefined) : undefined;

  // Names of the officials, to show who claimed a case: only when the profile may read them.
  const canReadOfficials = hasPermission(profile, 'officials:read');
  const namesReady = canReadOfficials && (!isSuperAdmin || scopeId !== undefined);
  useEffect(() => {
    if (!namesReady) {
      setOfficialNames(new Map());
      return;
    }
    const controller = new AbortController();
    (async () => {
      const names = new Map<string, string>();
      let cursor: string | null = null;
      for (let page = 0; page < MAX_OFFICIAL_PAGES; page += 1) {
        const result = await adminApi.listOfficials({ administrationId: scopeId, cursor, limit: 100 }, controller.signal);
        for (const item of result.items) names.set(item.id, item.displayName);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      return names;
    })().then(
      (names) => setOfficialNames(names),
      () => undefined, // the fallback label is enough
    );
    return () => controller.abort();
  }, [namesReady, scopeId]);

  const goHome = useCallback(() => {
    router.push('/admin');
    router.refresh();
  }, [router]);

  const selectAdministration = useCallback(
    async (id: string) => {
      const target = administrations.find((candidate) => candidate.id === id);
      if (busyRef.current || id === administrationId || !target || !isConnected(target)) return;
      busyRef.current = true;
      setActionError(null);
      try {
        const response = await postJson('/api/admin-administration', { administrationId: id });
        if (!response.ok) {
          setActionError(SWITCH_FAILED);
          return;
        }
        setRequestedId(id);
        goHome();
        toast.show(`Vous êtes maintenant : ${target.name}`);
      } catch {
        setActionError(SWITCH_FAILED);
      } finally {
        busyRef.current = false;
      }
    },
    [administrationId, administrations, goHome, toast.show],
  );

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const setOfficial = useCallback(
    (official: Official) => setProfile((current) => (current ? { ...current, official } : current)),
    [],
  );
  const can = useCallback((permission: Permission) => hasPermission(profile, permission), [profile]);
  const selfId = profile?.official.id;
  const selfName = profile?.official.displayName;
  const officialName = useCallback(
    (id: string) => officialNames.get(id) ?? (id === selfId && selfName ? selfName : anonymousOfficial(id)),
    [officialNames, selfId, selfName],
  );

  const value = useMemo<ConsoleValue>(
    () => ({
      profile,
      official: profile?.official ?? null,
      administrations,
      administrationId,
      administration,
      isSuperAdmin,
      scopeId,
      loading,
      error,
      can,
      officialName,
      selectAdministration,
      setOfficial,
      reload,
    }),
    [
      profile,
      administrations,
      administrationId,
      administration,
      isSuperAdmin,
      scopeId,
      loading,
      error,
      can,
      officialName,
      selectAdministration,
      setOfficial,
      reload,
    ],
  );

  return (
    <ConsoleContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
        <Toast message={toast.message} onDismiss={toast.dismiss} className="pointer-events-auto" />
        {actionError ? (
          <InlineAlert className="pointer-events-auto max-w-[460px] shadow-(--ui-shadow-pop)">{actionError}</InlineAlert>
        ) : null}
      </div>
    </ConsoleContext.Provider>
  );
}

export function useConsole(): ConsoleValue {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error('useConsole must be used inside a ConsoleProvider');
  return value;
}
