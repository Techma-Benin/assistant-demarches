'use client';

import { Tile, cn } from '@techma/ui';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { c3, type AdminConversation } from '@/lib/c3-client';
import { formatDateTime, shorten } from '@/lib/format';
import { formatRelative } from '@/lib/relative-time';
import { PagedFooter, usePagedList } from '../paginated-table';

const LIMIT = 20;
const loadConversations = (cursor: string | null) => c3.listConversations({ cursor, limit: LIMIT });

const CHANNELS: Record<AdminConversation['channel'], { label: string; dot: string }> = {
  web: { label: 'Web', dot: 'bg-viz-1' },
  whatsapp: { label: 'WhatsApp', dot: 'bg-viz-2' },
  mobile: { label: 'Mobile', dot: 'bg-viz-3' },
};

export function ConversationBrowser({ now }: { now?: Date }) {
  const [reference] = useState(() => now ?? new Date());
  const { items, nextCursor, status, error, retry, loadMore } = usePagedList(loadConversations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <div className="flex flex-wrap items-start gap-5">
      <section aria-label="Conversations" aria-busy={status === 'loading'} className="flex min-w-0 flex-[1_1_360px] flex-col gap-3">
        {status === 'loading' && items.length === 0 ? (
          <p role="status" className="text-sm text-ink-muted">
            Chargement…
          </p>
        ) : null}
        {status === 'idle' && items.length === 0 ? (
          <p className="rounded-card bg-sunken p-6 text-center text-ink-muted">Aucun élément à afficher.</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {items.map((conversation) => {
            const channel = CHANNELS[conversation.channel];
            const active = conversation.id === selected?.id;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(conversation.id)}
                  className={cn(
                    'ui-press flex min-h-11 w-full flex-col gap-2 rounded-[18px] border p-4 text-left text-ink',
                    active ? 'border-2 border-action bg-sunken' : 'border-line bg-surface hover:bg-sunken',
                  )}
                >
                  <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 text-[15px] font-bold">
                      <span aria-hidden="true" className={cn('size-2 rounded-[3px]', channel.dot)} />
                      {channel.label}
                    </span>
                    <span
                      className="text-xs text-ink-subtle"
                      title={formatDateTime(conversation.createdAt)}
                    >
                      {formatRelative(conversation.createdAt, reference)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-subtle">
                    <span className="font-mono break-all">{conversation.id}</span>
                    <span>
                      {conversation.locale} · usager{' '}
                      <span className="font-mono" title={conversation.userRef}>
                        {shorten(conversation.userRef, 12)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <PagedFooter
          status={status}
          error={error}
          noun="les conversations"
          hasMore={nextCursor !== null}
          onRetry={retry}
          onLoadMore={loadMore}
        />
      </section>

      <section
        aria-label="Détail de la conversation"
        className="flex min-w-0 flex-[2_1_520px] flex-col overflow-hidden rounded-tile border border-line"
      >
        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line-subtle bg-shell px-6 py-5">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-mono text-[13px] font-semibold break-all">{selected.id}</span>
                <span className="text-[13px] text-ink-subtle">
                  {CHANNELS[selected.channel].label} · {selected.locale} · usager{' '}
                  <span className="font-mono" title={selected.userRef}>
                    {shorten(selected.userRef, 12)}
                  </span>
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-xs font-bold">
                <Lock aria-hidden="true" className="size-3.5" />
                Pseudonymisé · pièces masquées
              </span>
            </div>
            <div className="p-6">
              <Tile tone="default" className="flex flex-col gap-3 p-6 md:p-7">
                <h2 className="font-display text-[22px] font-extrabold tracking-[-0.03em]">
                  Transcription bientôt disponible
                </h2>
                <p className="text-sm text-ink-muted">
                  Le contenu des échanges n’est pas encore exposé par l’API d’administration.
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-ink-subtle">Créée le</dt>
                  <dd>{formatDateTime(selected.createdAt)}</dd>
                  <dt className="text-ink-subtle">Canal</dt>
                  <dd>{CHANNELS[selected.channel].label}</dd>
                  <dt className="text-ink-subtle">Langue</dt>
                  <dd>{selected.locale}</dd>
                  <dt className="text-ink-subtle">Usager</dt>
                  <dd className="font-mono break-all">{selected.userRef}</dd>
                </dl>
              </Tile>
            </div>
          </>
        ) : (
          <p className="p-8 text-center text-ink-muted">Sélectionnez une conversation pour voir ses métadonnées.</p>
        )}
      </section>
    </div>
  );
}
