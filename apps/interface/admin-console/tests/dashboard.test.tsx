process.env.TZ = 'UTC';

import { screen, within } from '@testing-library/react';
import { render } from './helpers/session';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '@/components/dashboard';
import { json, problem, stubC3 } from './helpers/c3-fetch';
import { C3Error, type Metrics } from '@/lib/c3-client';
import { formatLongDay, formatDateTime, formatFcfa, formatInteger, formatMs, formatRate, formatSeconds, shorten } from '@/lib/format';

// fr-FR separators are narrow no-break spaces: compare on a normalised string.
const norm = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');

const metrics: Metrics = { conversationCount: 12345, p95LatencyMs: 1820, sourcedAnswerRate: 0.875, errorCount: 3 };

describe('formatters', () => {
  it('formats numbers in fr-FR', () => {
    expect(norm(formatInteger(12345))).toBe('12 345');
    expect(norm(formatMs(1820))).toBe('1 820 ms');
    expect(norm(formatRate(0.875))).toBe('87,5 %');
    expect(formatSeconds(3200)).toBe('3,2 s');
    expect(formatSeconds(1820)).toBe('1,8 s');
    expect(norm(formatFcfa(15000))).toBe('15 000 FCFA');
  });

  it('shows 0 FCFA as Gratuit', () => {
    expect(formatFcfa(0)).toBe('Gratuit');
  });

  it('formats dates and falls back on invalid input', () => {
    expect(norm(formatDateTime('2026-03-04T10:30:00Z'))).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('shortens long identifiers only', () => {
    expect(shorten('abcdefghijklmnop', 12)).toBe('abcdefghijkl…');
    expect(shorten('abc', 12)).toBe('abc');
  });
});

describe('Dashboard', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubEmpty = () => stubC3({ lists: {} });

  it('shows the four formatted metrics', async () => {
    stubEmpty();
    render(<Dashboard load={async () => metrics} />);
    expect(norm((await screen.findByText('12 345', { exact: false })).textContent)).toBe('12 345');
    expect(screen.getByText('Conversations', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('1,8 s')).toBeInTheDocument();
    const rate = screen.getByText(/%$/);
    expect(norm(rate.textContent)).toBe('87,5 %');
    expect(rate.parentElement?.className).toContain('text-trust-text');
    expect(screen.getByText('Erreurs')).toBeInTheDocument();
    expect(screen.getByText('3').parentElement?.className).toContain('text-danger');
    expect(screen.getByText('Garde-fous')).toBeInTheDocument();
  });

  it('shows the loading state first', () => {
    stubEmpty();
    render(<Dashboard load={() => new Promise<Metrics>(() => {})} />);
    expect(screen.getByText('Latence p95').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an error alert and retries', async () => {
    stubEmpty();
    const load = vi
      .fn<() => Promise<Metrics>>()
      .mockRejectedValueOnce(new C3Error(500))
      .mockResolvedValueOnce(metrics);
    render(<Dashboard load={load} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les indicateurs.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Réponses sourcées')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for admin access on 403', async () => {
    stubEmpty();
    render(<Dashboard load={async () => Promise.reject(new C3Error(403))} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Accès administrateur requis');
  });

  describe('metric tiles', () => {
    it('shows - and a caption for a p95 of 0', async () => {
      stubEmpty();
      render(<Dashboard load={async () => ({ ...metrics, p95LatencyMs: 0 })} />);
      expect(await screen.findByText('Pas encore mesuré')).toBeInTheDocument();
      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('keeps the sourced rate neutral at 0 and says no error at 0', async () => {
      stubEmpty();
      render(<Dashboard load={async () => ({ ...metrics, sourcedAnswerRate: 0, errorCount: 0 })} />);
      expect(await screen.findByText('Aucune réponse sourcée mesurée')).toBeInTheDocument();
      expect(screen.getByText('Aucune erreur')).toBeInTheDocument();
      expect(screen.getByText(/%$/).parentElement?.className).not.toContain('text-trust-text');
    });
  });

  describe('collections', () => {
    const now = new Date();
    const conv = (id: string, channel: string, createdAt = now.toISOString()) => ({
      id,
      userRef: 'u',
      channel,
      locale: 'fr',
      createdAt,
    });
    const conversations = [conv('c1', 'web'), conv('c2', 'whatsapp'), conv('c3', 'whatsapp'), conv('c4', 'whatsapp')];

    it('shows the tooltip on hover and focus, and the per-channel table on demand', async () => {
      stubC3({ lists: { conversations: [conversations] } });
      render(<Dashboard load={async () => metrics} />);
      const hits = await screen.findAllByTestId('day-hit');
      expect(hits).toHaveLength(14);
      const user = userEvent.setup();
      await user.hover(hits[13]);
      expect(screen.getByRole('tooltip')).toHaveTextContent(`${formatLongDay(now)} · 4 conversations`);
      await user.unhover(hits[13]);
      expect(screen.queryByRole('tooltip')).toBeNull();
      hits[13].focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent('4 conversations');

      const legend = screen.getByRole('list', { name: 'Légende des canaux' });
      expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Web', 'WhatsApp', 'Mobile']);

      expect(screen.queryByRole('table')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Voir le tableau' }));
      const table = screen.getByRole('table', { name: 'Conversations par jour' });
      const rows = within(table).getAllByRole('row');
      expect(rows).toHaveLength(15);
      expect(rows[14]).toHaveTextContent(/1\s*3\s*0\s*4$/);
      await user.click(screen.getByRole('button', { name: 'Masquer le tableau' }));
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('lists the todo rows with filtered links, hiding empty ones', async () => {
      const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
      stubC3({
        lists: {
          procedures: [[
            { id: 'p1', title: 'Passeport', validationStatus: 'draft', source: { retrievedAt: old } },
            { id: 'p2', title: 'CIP', validationStatus: 'validated', source: { retrievedAt: now.toISOString() } },
          ]],
          tools: [[{ name: 'search', enabled: false }]],
        },
      });
      render(<Dashboard load={async () => metrics} />);
      const drafts = await screen.findByRole('link', { name: /Fiches en brouillon/ });
      expect(drafts).toHaveAttribute('href', '/procedures?status=draft');
      expect(screen.getByRole('link', { name: /Connexions MCP désactivées/ })).toHaveAttribute('href', '/tools');
      expect(screen.getByRole('link', { name: /Source à revérifier/ })).toHaveAttribute('href', '/procedures?stale=1');
      expect(screen.queryByText(/Questions sans fiche/)).toBeNull();
      expect(screen.queryByText('Rien à traiter')).toBeNull();
    });

    it('says Rien à traiter when nothing is pending', async () => {
      stubC3({ lists: { procedures: [[{ id: 'p', validationStatus: 'validated', source: { retrievedAt: now.toISOString() } }]] } });
      render(<Dashboard load={async () => metrics} />);
      expect(await screen.findByText('Rien à traiter')).toBeInTheDocument();
    });

    it('isolates a failing collection with its own retry', async () => {
      let failing = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const resource = new URL(String(input), 'http://console.local').pathname.split('/').pop();
          if (resource === 'procedures' && failing) return problem(500, 'INTERNAL', 'boom');
          return json({ items: resource === 'conversations' ? conversations : [], nextCursor: null });
        }),
      );
      render(<Dashboard load={async () => metrics} />);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Impossible de charger les éléments à traiter.');
      expect(await screen.findAllByTestId('day-hit')).toHaveLength(14);
      expect(await screen.findAllByRole('alert')).toHaveLength(1);
      failing = false;
      await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(await screen.findByText('Rien à traiter')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
