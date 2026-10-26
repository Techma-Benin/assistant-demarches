import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dashboard } from '@/components/dashboard';
import { C3Error, type Metrics } from '@/lib/c3-client';
import { formatDateTime, formatFcfa, formatInteger, formatMs, formatRate, shorten } from '@/lib/format';

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
  it('shows skeletons then the four formatted metrics', async () => {
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
    render(<Dashboard load={() => new Promise<Metrics>(() => {})} />);
    expect(screen.getByText('Latence p95').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an error alert and retries', async () => {
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
    render(<Dashboard load={async () => Promise.reject(new C3Error(403))} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Accès administrateur requis');
  });
});
