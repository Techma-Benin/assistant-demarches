'use client';

import { Button, Card, InlineAlert, cn } from '@techma/ui';
import { useCallback, useEffect, useState } from 'react';
import { c3, type Metrics } from '@/lib/c3-client';
import { formatInteger, formatMs, formatRate } from '@/lib/format';
import { errorMessage } from './paginated-table';

function MetricCard({
  label,
  value,
  tone = 'default',
  valueClassName,
  index,
}: {
  label: string;
  value: string | null;
  tone?: 'default' | 'trust';
  valueClassName?: string;
  index: number;
}) {
  return (
    <Card
      tone={tone}
      className="ui-rise flex flex-col gap-2"
      style={{ transitionDelay: `${index * 40}ms` }}
      aria-busy={value === null}
    >
      <p className="text-sm text-ink-muted">{label}</p>
      {value === null ? (
        <span aria-hidden="true" className="block h-8 w-1/2 animate-pulse rounded-pill bg-sunken" />
      ) : (
        <p key="value" className={cn('ui-swap text-[28px] leading-tight font-extrabold tracking-tight', valueClassName)}>{value}</p>
      )}
    </Card>
  );
}

export function Dashboard({ load = () => c3.getMetrics() }: { load?: () => Promise<Metrics> }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<unknown>(null);

  const fetchMetrics = useCallback(async () => {
    setError(null);
    try {
      setMetrics(await load());
    } catch (caught) {
      setError(caught);
    }
  }, [load]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <InlineAlert>
            {errorMessage(error, 'les indicateurs')}
          </InlineAlert>
          <Button variant="secondary" size="sm" onClick={() => void fetchMetrics()}>
            Réessayer
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Conversations" index={0} value={metrics && formatInteger(metrics.conversationCount)} />
          <MetricCard label="Latence p95" index={1} value={metrics && formatMs(metrics.p95LatencyMs)} />
          <MetricCard
            label="Réponses sourcées"
            index={2}
            tone="trust"
            valueClassName="text-trust-text"
            value={metrics && formatRate(metrics.sourcedAnswerRate)}
          />
          <MetricCard
            label="Erreurs"
            index={3}
            value={metrics && formatInteger(metrics.errorCount)}
            valueClassName={metrics && metrics.errorCount > 0 ? 'text-danger' : undefined}
          />
        </div>
      )}
    </div>
  );
}
