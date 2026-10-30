'use client';

import { Button, InlineAlert, StatusPill, Tile, Toast, cn } from '@techma/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { c3, type ModelConfig } from '@/lib/c3-client';
import { toSaveFailure } from '@/lib/error-messages';
import { formatTemperature } from '@/lib/format';
import { activateModel, describeActivationError } from '@/lib/model-activation';
import { PageHeader } from '../page-header';
import { PagedFooter, usePagedList } from '../paginated-table';
import { ReadOnlyNote } from '../session/read-only-note';
import { useSession } from '../session/session-context';
import { useToast } from '../use-toast';

const LIMIT = 20;

export function ModelsOverview() {
  const load = useCallback((cursor: string | null) => c3.listModels({ cursor, limit: LIMIT }), []);
  const { items, nextCursor, status, error, retry, loadMore, reload } = usePagedList(load);
  // Values confirmed by a PUT, over the loaded rows.
  const [saved, setSaved] = useState<Record<string, ModelConfig>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const canEdit = useSession().can('models.edit');

  const models = items.map((model) => saved[model.id] ?? model);
  const active = models.find((model) => model.active) ?? null;

  const activate = async (next: ModelConfig) => {
    setFailure(null);
    setBusy(true);
    try {
      const result = await activateModel(next, active);
      setSaved((values) => ({ ...values, ...Object.fromEntries(result.saved.map((model) => [model.id, model])) }));
      toast.show(`Modèle actif : ${next.model}`);
    } catch (caught) {
      setFailure(describeActivationError(caught));
      setSaved({});
      reload();
    } finally {
      setBusy(false);
    }
  };

  const saveTemperature = async (model: ModelConfig, temperature: number) => {
    setFailure(null);
    setBusy(true);
    try {
      const updated = await c3.updateModel({ ...model, temperature }, `model-${model.id}-${crypto.randomUUID()}`);
      setSaved((values) => ({ ...values, [updated.id]: updated }));
      toast.show('Température enregistrée');
    } catch (caught) {
      setFailure(toSaveFailure(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Modèle IA"
        description="Le modèle en service, ses instructions et son réglage."
        actions={<Toast message={toast.message} onDismiss={toast.dismiss} />}
      />
      {canEdit ? null : <div className="mb-4"><ReadOnlyNote /></div>}
      {failure ? <InlineAlert className="mb-4">{failure}</InlineAlert> : null}
      {status === 'idle' && models.length === 0 ? (
        <p className="rounded-card bg-sunken p-6 text-center text-ink-muted">Aucun élément à afficher.</p>
      ) : null}
      <div className="flex flex-wrap items-start gap-4">
        {active ? (
          <ActiveModelTile key={active.id} model={active} busy={busy} readOnly={!canEdit} onSave={saveTemperature} />
        ) : status === 'idle' && models.length > 0 ? (
          <Tile tone="outline" className="min-w-0 flex-[2_1_520px]">
            <p className="font-display text-2xl font-extrabold">Aucun modèle actif</p>
            <p className="mt-2 text-ink-muted">Activez une configuration dans la liste.</p>
          </Tile>
        ) : null}

        <section aria-labelledby="configurations-title" className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5">
          <h2 id="configurations-title" className="mb-1 font-display text-[22px] font-extrabold tracking-[-0.03em]">
            Configurations
          </h2>
          <ul className="flex flex-col gap-2.5">
            {models.map((model) => (
              <li
                key={model.id}
                className={cn(
                  'flex flex-col gap-3 rounded-[22px] p-[18px]',
                  model.active ? 'border-2 border-trust bg-trust-soft text-ink' : 'border border-line bg-surface',
                )}
              >
                <div className="flex flex-col gap-1">
                  <span className="text-base font-bold">{model.model}</span>
                  <span className="text-[13px] text-ink-muted">
                    {model.provider} · <span className="font-mono">{model.promptVersion}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {model.active ? (
                    <StatusPill status="validated" icon={<Check aria-hidden="true" className="size-4" />} className="bg-transparent px-0">
                      En service
                    </StatusPill>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={busy || !canEdit}
                      aria-label={`Activer à la place : ${model.model} (${model.id})`}
                      onClick={() => void activate(model)}
                    >
                      Activer à la place
                    </Button>
                  )}
                  <Link
                    href={`/models/${encodeURIComponent(model.id)}`}
                    aria-label={`Modifier ${model.id}`}
                    className="inline-flex min-h-11 items-center px-2 text-sm font-semibold underline"
                  >
                    Modifier
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <PagedFooter
            status={status}
            error={error}
            noun="les modèles"
            hasMore={nextCursor !== null}
            onRetry={retry}
            onLoadMore={loadMore}
          />
          <p className="mt-1 text-[13px] leading-normal text-ink-subtle">Exactement un modèle actif est exigé.</p>
        </section>
      </div>
    </>
  );
}

function ActiveModelTile({
  model,
  busy,
  readOnly,
  onSave,
}: {
  model: ModelConfig;
  busy: boolean;
  readOnly: boolean;
  onSave: (model: ModelConfig, temperature: number) => Promise<void>;
}) {
  const [temperature, setTemperature] = useState(model.temperature);
  // The confirmed value changed (saved, or reloaded): follow it.
  useEffect(() => setTemperature(model.temperature), [model.temperature]);
  const changed = temperature !== model.temperature;
  const label = formatTemperature(temperature);

  return (
    <Tile tone="ink" className="flex min-w-0 flex-[2_1_520px] flex-col gap-5 p-7 md:p-9">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <StatusPill status="submitted" className="bg-trust px-3 py-1.5 font-extrabold">
          Modèle actif
        </StatusPill>
        <span className="font-mono text-[13px] text-on-action/70">{model.id}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[15px] text-on-action/70">{model.provider}</span>
        <h2 className="font-display text-[clamp(36px,4vw,52px)] leading-none font-extrabold tracking-[-0.045em] break-words">
          {model.model}
        </h2>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <span className="rounded-[14px] bg-on-action/10 px-3.5 py-2.5 text-sm">
          <span className="text-on-action/70">Instructions</span> <b className="font-mono">{model.promptVersion}</b>
        </span>
        <span className="rounded-[14px] bg-on-action/10 px-3.5 py-2.5 text-sm">
          <span className="text-on-action/70">Température</span> <b>{formatTemperature(model.temperature)}</b>
        </span>
      </div>
      <div className="flex flex-col gap-2.5 rounded-[18px] bg-on-action/10 p-[18px]">
        <label htmlFor="model-temperature" className="text-sm font-bold">
          Température · {label}
        </label>
        <input
          id="model-temperature"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          disabled={busy || readOnly}
          onChange={(event) => setTemperature(Number(event.target.value))}
          className="min-h-11 w-full accent-sun"
        />
        <span className="flex justify-between text-xs text-on-action/70">
          <span>0 · factuel</span>
          <span>2 · créatif</span>
        </span>
        <div className="flex flex-wrap gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11"
            disabled={!changed || busy || readOnly}
            onClick={() => void onSave(model, temperature)}
          >
            Enregistrer la température
          </Button>
          {changed ? (
            <Button variant="ghost" size="sm" className="min-h-11 text-on-action hover:bg-on-action/10" disabled={busy} onClick={() => setTemperature(model.temperature)}>
              Annuler
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-sm leading-normal text-on-action/70">
        Pour des démarches administratives, une température basse (0 à 0,3) limite les reformulations hasardeuses.
      </p>
    </Tile>
  );
}
