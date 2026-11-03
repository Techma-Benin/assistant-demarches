'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandMark, Button, InlineAlert, StatusPill, ThemeToggle, TypingIndicator } from '@techma/ui';
import { ArrowLeft } from 'lucide-react';
import { CaseCard, CaseReference } from '@/components/blocks/CaseCardBlock';
import { loginHref } from '@/lib/auth-links';
import { C1Client, C1Error } from '@/lib/c1-client';
import { CASE_STATUS_LABELS, CASE_STATUS_PILL, administrationLabel, formatDateFr, type Case } from '@/lib/cases';

type Access = 'checking' | 'guest' | 'user';

function Shell({ title, back, children }: { title: string; back?: { href: string; label: string }; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line-subtle">
        <div className="mx-auto flex max-w-[960px] items-center gap-3 px-4 py-3 md:px-6 md:py-4">
          <Link href="/" aria-label="Accueil" className="shrink-0 rounded-pill no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink">
            <BrandMark />
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8 md:px-6 md:py-10">
        {back && (
          <Link href={back.href} className="inline-flex min-h-11 items-center gap-2 self-start text-[15px] font-semibold text-ink underline-offset-4 hover:underline">
            <ArrowLeft aria-hidden="true" className="size-4" />
            {back.label}
          </Link>
        )}
        <h1 className="m-0 font-display text-[clamp(32px,4vw,48px)] font-extrabold leading-none tracking-[-0.04em]">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function GuestPrompt({ returnTo }: { returnTo: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-card bg-sunken p-6">
      <p className="m-0 text-[17px] font-semibold">Connectez-vous pour voir vos démarches</p>
      <Button asChild size="lg" className="min-h-[52px] px-7 font-bold">
        <a href={loginHref(returnTo)}>Se connecter</a>
      </Button>
    </div>
  );
}

const isAuthError = (error: unknown) => error instanceof C1Error && (error.status === 401 || error.status === 403);

/** Who is behind the browser: `user: null` is a guest (`GET /api/session`). */
function useAccess(): Access {
  const [access, setAccess] = useState<Access>('checking');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then((response) => (response.ok ? response.json() : { user: null }))
      .then((data: { user?: unknown }) => {
        if (!cancelled) setAccess(data.user ? 'user' : 'guest');
      })
      .catch(() => {
        if (!cancelled) setAccess('user'); // Unknown: let the API answer (401/403 shows the same prompt).
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return access;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-muted">
      <TypingIndicator label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

export function CaseListItem({ item }: { item: Case }) {
  return (
    <li className="flex flex-col gap-3 rounded-[24px] border border-line bg-surface p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill status={CASE_STATUS_PILL[item.status]}>{CASE_STATUS_LABELS[item.status]}</StatusPill>
        <CaseReference item={item} />
      </div>
      <h2 className="m-0 font-display text-[22px] font-extrabold leading-[1.2] tracking-[-0.02em]">
        <Link href={`/demarches/${item.id}`} className="text-ink underline-offset-4 hover:underline">
          {item.title}
        </Link>
      </h2>
      <p className="m-0 text-[14px] text-ink-muted">
        {administrationLabel(item.administrationId)} · Mise à jour le {formatDateFr(item.updatedAt)}
      </p>
    </li>
  );
}

/** « Mes démarches »: the cases filed by the person (`GET /v1/cases`, cursor pagination). */
export function MyCases({ client }: { client?: C1Client }) {
  const c1 = useMemo(() => client ?? new C1Client(), [client]);
  const access = useAccess();
  const [items, setItems] = useState<Case[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'guest'>('loading');
  const started = useRef(false);

  const load = useCallback(
    async (from: string | null) => {
      setState('loading');
      try {
        const page = await c1.listCases(from);
        setItems((all) => (from ? [...all, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setState('idle');
      } catch (error) {
        setState(isAuthError(error) ? 'guest' : 'error');
      }
    },
    [c1],
  );

  useEffect(() => {
    if (access !== 'user' || started.current) return;
    started.current = true;
    void load(null);
  }, [access, load]);

  let body: ReactNode;
  if (access === 'checking') body = <Loading label="Chargement…" />;
  else if (access === 'guest' || state === 'guest') body = <GuestPrompt returnTo="/demarches" />;
  else if (state === 'error' && items.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-4">
        <InlineAlert>Impossible de charger vos démarches pour le moment.</InlineAlert>
        <Button variant="secondary" onClick={() => void load(null)}>
          Réessayer
        </Button>
      </div>
    );
  } else if (state === 'loading' && items.length === 0) body = <Loading label="Chargement de vos démarches…" />;
  else if (items.length === 0) body = <p className="m-0 text-[17px] text-ink-muted">Vous n’avez pas encore déposé de démarche.</p>;
  else {
    body = (
      <>
        <ul aria-label="Vos démarches" className="m-0 flex list-none flex-col gap-4 p-0">
          {items.map((item) => (
            <CaseListItem key={item.id} item={item} />
          ))}
        </ul>
        {state === 'error' && <InlineAlert>Impossible de charger la suite.</InlineAlert>}
        {cursor !== null && (
          <Button variant="secondary" className="self-start" disabled={state === 'loading'} onClick={() => void load(cursor)}>
            {state === 'loading' ? 'Chargement…' : 'Voir plus'}
          </Button>
        )}
      </>
    );
  }
  return (
    <Shell title="Mes démarches" back={{ href: '/', label: 'Accueil' }}>
      {body}
    </Shell>
  );
}

/** One case of « Mes démarches » (`GET /v1/cases/{caseId}`), same content as the `caseCard` block. */
export function CaseDetail({ caseId, client }: { caseId: string; client?: C1Client }) {
  const c1 = useMemo(() => client ?? new C1Client(), [client]);
  const [item, setItem] = useState<Case | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'guest' | 'missing'>('loading');

  const load = useCallback(() => {
    setState('loading');
    c1.getCase(caseId).then(
      (found) => setItem(found),
      (error) => setState(isAuthError(error) ? 'guest' : error instanceof C1Error && error.status === 404 ? 'missing' : 'error'),
    );
  }, [c1, caseId]);

  useEffect(() => {
    load();
  }, [load]);

  let body: ReactNode;
  if (item) body = <CaseCard item={item} heading="h2" />;
  else if (state === 'guest') body = <GuestPrompt returnTo={`/demarches/${caseId}`} />;
  else if (state === 'missing') body = <p className="m-0 text-[17px] text-ink-muted">Cette démarche est introuvable.</p>;
  else if (state === 'error') {
    body = (
      <div className="flex flex-col items-start gap-4">
        <InlineAlert>Impossible de charger cette démarche pour le moment.</InlineAlert>
        <Button variant="secondary" onClick={load}>
          Réessayer
        </Button>
      </div>
    );
  } else body = <Loading label="Chargement…" />;
  return (
    <Shell title="Ma démarche" back={{ href: '/demarches', label: 'Mes démarches' }}>
      {body}
    </Shell>
  );
}
