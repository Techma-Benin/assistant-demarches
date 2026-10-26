process.env.TZ = 'UTC';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '@/components/dashboard';
import { json, problem, stubC3 } from './helpers/c3-fetch';
import { C3Error, type Metrics } from '@/lib/c3-client';
import { formatLongDay, formatDateTime, formatFcfa, formatInteger, formatMs, formatRate, shorten } from '@/lib/format';

// fr-FR separators are narrow no-break spaces: compare on a normalised string.
const norm = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');

const metrics: Metrics = { conversationCount: 12345, p95LatencyMs: 1820, sourcedAnswerRate: 0.875, errorCount: 3 };

describe('formatters', () => {
  it('formats numbers in fr-FR', () => {
    expect(norm(formatInteger(12345))).toBe('12 345');
    expect(norm(formatMs(1820))).toBe('1 820 ms');
    expect(norm(formatRate(0.875))).toBe('87,5 %');
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

  it('shows skeletons then the four formatted metrics', async () => {
    stubEmpty();
    render(<Dashboard load={async () => metrics} />);
    expect(norm((await screen.findByText('12 345', { exact: false })).textContent)).toBe('12 345');
    expect(screen.getByText('Conversations')).toBeInTheDocument();
    expect(norm(screen.getByText(/ms$/).textContent)).toBe('1 820 ms');
    const rate = screen.getByText(/%$/);
    expect(norm(rate.textContent)).toBe('87,5 %');
    expect(rate.className).toContain('text-trust-text');
    expect(screen.getByText('Erreurs')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
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
    it('shows — and a caption for a p95 of 0', async () => {
      stubEmpty();
      render(<Dashboard load={async () => ({ ...metrics, p95LatencyMs: 0 })} />);
      expect(await screen.findByText('Pas encore mesuré')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('keeps the sourced rate neutral at 0 and says no error at 0', async () => {
      stubEmpty();
      render(<Dashboard load={async () => ({ ...metrics, sourcedAnswerRate: 0, errorCount: 0 })} />);
      expect(await screen.findByText('Aucune réponse sourcée mesurée')).toBeInTheDocument();
      expect(screen.getByText('Aucune erreur')).toBeInTheDocument();
      const rate = screen.getByText(/%$/);
      expect(rate.className).not.toContain('text-trust-text');
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

    it('shows the tooltip on hover and focus, and the table on demand', async () => {
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

      expect(screen.queryByRole('table')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Voir le tableau' }));
      const table = screen.getByRole('table', { name: 'Conversations par jour' });
      expect(within(table).getAllByRole('row')).toHaveLength(15);
      await user.click(screen.getByRole('button', { name: 'Masquer le tableau' }));
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('shows counts and percentages in the channel legend', async () => {
      stubC3({ lists: { conversations: [conversations] } });
      render(<Dashboard load={async () => metrics} />);
      const legend = await screen.findByRole('list', { name: 'Conversations par canal' });
      const items = within(legend).getAllByRole('listitem').map((item) => norm(item.textContent));
      expect(items).toEqual(['Web1 (25 %)', 'WhatsApp3 (75 %)', 'Mobile0 (0 %)']);
    });

    it('lists pending items with links', async () => {
      stubC3({
        lists: {
          procedures: [[{ id: 'p1', title: 'Passeport', validationStatus: 'draft' }]],
          tools: [[{ name: 'search', enabled: false }]],
          models: [[{ id: 'm1', provider: 'x', model: 'y', promptVersion: 'v1', temperature: 0.2, active: false }]],
        },
      });
      render(<Dashboard load={async () => metrics} />);
      expect(await screen.findByText('Aucun modèle actif', { selector: 'li span' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Modifier Passeport' })).toHaveAttribute('href', '/procedures/p1');
      expect(screen.getByText('Brouillon')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /search/ })).toHaveAttribute('href', '/tools');
    });

    it('reassures when nothing is pending and links the active model', async () => {
      stubC3({
        lists: { models: [[{ id: 'm1', provider: 'acme', model: 'big-1', promptVersion: 'v7', temperature: 0.2, active: true }]] },
      });
      render(<Dashboard load={async () => metrics} />);
      expect(await screen.findByText('Rien à traiter pour le moment.')).toBeInTheDocument();
      expect(screen.getByText('big-1')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Régler m1' })).toHaveAttribute('href', '/models/m1');
    });

    it('isolates a failing collection with its own retry', async () => {
      let failing = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const resource = new URL(String(input), 'http://console.local').pathname.split('/').pop();
          if (resource === 'audit' && failing) return problem(500, 'INTERNAL', 'boom');
          return json({ items: resource === 'conversations' ? conversations : [], nextCursor: null });
        }),
      );
      render(<Dashboard load={async () => metrics} />);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Impossible de charger le journal d’audit.');
      expect(await screen.findByText('Dernières conversations')).toBeInTheDocument();
      expect(screen.getAllByText('Web').length).toBeGreaterThan(0);
      expect(await screen.findAllByRole('alert')).toHaveLength(1);
      failing = false;
      await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(await screen.findByText('Aucune modification enregistrée.')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
