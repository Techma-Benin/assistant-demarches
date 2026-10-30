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
import type { AdminProfile, Department, SessionOption } from '@/lib/console-types';
import { newTraceparent } from '@/lib/trace';
import { useToast } from '../use-toast';

export interface ConsoleValue {
  profile: AdminProfile | null;
  departments: Department[];
  departmentId: string | null;
  department: Department | null;
  isSuperAdmin: boolean;
  sessions: SessionOption[];
  activeSessionId: string;
  loading: boolean;
  error: string | null;
  switchSession(id: string): Promise<void>;
  selectDepartment(id: string): Promise<void>;
  reload(): void;
}

const ConsoleContext = createContext<ConsoleValue | null>(null);

const LOAD_FAILED = 'Impossible de charger votre profil. Réessayez.';
const SWITCH_FAILED = 'Impossible de changer de session. Réessayez.';
const ERROR_DURATION = 6000;
const MAX_DEPARTMENT_PAGES = 5;

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/admin${path}`, { headers: { traceparent: newTraceparent() }, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function loadDepartments(signal: AbortSignal): Promise<Department[]> {
  const items: Department[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_DEPARTMENT_PAGES; page += 1) {
    const query: string = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const result: { items: Department[]; nextCursor: string | null } = await getJson(
      `/v1/admin/departments${query}`,
      signal,
    );
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return items;
}

/** Departments the person may act on: a super admin sees all of them, others only their own (Backend decides). */
function accessibleDepartments(profile: AdminProfile | null, departments: Department[]): Department[] {
  if (!profile) return [];
  if (profile.superAdmin) return departments;
  const own = new Set(profile.departmentIds);
  return departments.filter((department) => own.has(department.id));
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', traceparent: newTraceparent() },
    body: JSON.stringify(body),
  });
}

export function ConsoleProvider({
  initialSessions,
  initialSessionId,
  initialDepartmentId,
  children,
}: {
  initialSessions: SessionOption[];
  initialSessionId: string;
  initialDepartmentId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sessions] = useState(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionId);
  const [requestedDepartmentId, setRequestedDepartmentId] = useState(initialDepartmentId);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const busyRef = useRef(false);
  const announceRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([getJson<AdminProfile>('/v1/admin/me', controller.signal), loadDepartments(controller.signal)]).then(
      ([me, departments]) => {
        setProfile(me);
        setAllDepartments(departments);
        setLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setProfile(null);
        setAllDepartments([]);
        setError(LOAD_FAILED);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [activeSessionId, reloadKey]);

  useEffect(() => {
    if (actionError === null) return;
    const timer = setTimeout(() => setActionError(null), ERROR_DURATION);
    return () => clearTimeout(timer);
  }, [actionError]);

  const departments = useMemo(() => accessibleDepartments(profile, allDepartments), [profile, allDepartments]);
  const department = useMemo(
    () =>
      departments.find((candidate) => candidate.id === requestedDepartmentId) ?? departments[0] ?? null,
    [departments, requestedDepartmentId],
  );
  const departmentId = department?.id ?? null;
  const sessionLabel = sessions.find((session) => session.id === activeSessionId)?.label ?? '';

  // After a switch: announce once the new profile (and so the ministry) is known.
  useEffect(() => {
    if (!announceRef.current || loading || !profile) return;
    announceRef.current = false;
    toast.show(`Vous êtes maintenant : ${sessionLabel}${department ? ` · ${department.name}` : ''}`);
  }, [loading, profile, department, sessionLabel, toast.show]);

  const goHome = useCallback(() => {
    router.push('/');
    router.refresh();
  }, [router]);

  const switchSession = useCallback(
    async (id: string) => {
      if (busyRef.current || id === activeSessionId) return;
      busyRef.current = true;
      setActionError(null);
      try {
        const response = await postJson('/api/session', { sessionId: id });
        if (!response.ok) {
          setActionError(SWITCH_FAILED);
          return;
        }
        announceRef.current = true;
        setProfile(null);
        setAllDepartments([]);
        setRequestedDepartmentId(null);
        setActiveSessionId(id);
        goHome();
      } catch {
        setActionError(SWITCH_FAILED);
      } finally {
        busyRef.current = false;
      }
    },
    [activeSessionId, goHome],
  );

  const selectDepartment = useCallback(
    async (id: string) => {
      if (busyRef.current || id === departmentId) return;
      busyRef.current = true;
      setActionError(null);
      try {
        const response = await postJson('/api/session/department', { departmentId: id });
        if (!response.ok) {
          setActionError(SWITCH_FAILED);
          return;
        }
        setRequestedDepartmentId(id);
        goHome();
        const name = departments.find((candidate) => candidate.id === id)?.name ?? id;
        toast.show(`Vous êtes maintenant : ${sessionLabel} · ${name}`);
      } catch {
        setActionError(SWITCH_FAILED);
      } finally {
        busyRef.current = false;
      }
    },
    [departmentId, departments, goHome, sessionLabel, toast.show],
  );

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const value = useMemo<ConsoleValue>(
    () => ({
      profile,
      departments,
      departmentId,
      department,
      isSuperAdmin: profile?.superAdmin ?? false,
      sessions,
      activeSessionId,
      loading,
      error,
      switchSession,
      selectDepartment,
      reload,
    }),
    [profile, departments, departmentId, department, sessions, activeSessionId, loading, error, switchSession, selectDepartment, reload],
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
