import { screen, within } from '@testing-library/react';
import { render } from './helpers/session';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcedureBrowser } from '@/components/procedures/procedure-browser';
import { filterProcedures, formatSourceAge, isStaleSource, parseStatusFilter } from '@/lib/procedure-list';
import { stubC3 } from './helpers/c3-fetch';

const NOW = new Date('2026-10-30T12:00:00Z');

const make = (id: string, title: string, validationStatus: 'draft' | 'validated', retrievedAt: string) => ({
  id,
  title,
  administrationId: 'dgdi',
  summary: 'Résumé.',
  requiredDocuments: [],
  feeFcfa: 0,
  processingDays: 1,
  source: { procedureId: id, url: 'https://example.org', retrievedAt, version: 'v1' },
  validationStatus,
  formSchema: {},
});

const passeport = make('passeport-renouvellement', 'Renouvellement de passeport', 'validated', '2026-10-18T12:00:00Z'); // 12 jours
const casier = make('casier-judiciaire', 'Casier judiciaire', 'validated', '2026-05-01T12:00:00Z'); // périmée
const entreprise = make('creation-entreprise', 'Création d’entreprise', 'draft', '2026-10-29T12:00:00Z'); // 1 jour
const naissance = make('acte-naissance', 'Acte de naissance', 'draft', '2026-01-10T12:00:00Z'); // périmée

afterEach(() => vi.unstubAllGlobals());

async function renderBrowser(props: Parameters<typeof ProcedureBrowser>[0] = {}, pages = [[passeport, casier, entreprise, naissance]]) {
  stubC3({ lists: { procedures: pages } });
  render(<ProcedureBrowser now={NOW} {...props} />);
  await screen.findAllByRole('listitem');
  return userEvent.setup();
}

const titles = () => within(screen.getByRole('list', { name: 'Fiches de démarche' })).getAllByRole('listitem').map((li) => li.textContent);

describe('ProcedureBrowser', () => {
  it('shows cards with title, mono id, status pill and source age (red and bold beyond 90 days)', async () => {
    await renderBrowser();
    const card = screen.getByRole('link', { name: /Renouvellement de passeport/ });
    expect(card).toHaveAttribute('href', '/procedures/passeport-renouvellement');
    expect(within(card).getByText('passeport-renouvellement')).toHaveClass('font-mono');
    expect(within(card).getByText('Validée')).toBeInTheDocument();
    expect(within(card).getByText('Source · il y a 12 jours')).not.toHaveClass('font-bold');
    const old = screen.getByRole('link', { name: /Casier judiciaire/ });
    expect(within(old).getByText(/Source · il y a \d+ jours/)).toHaveClass('font-bold', 'text-danger');
    expect(within(screen.getByRole('link', { name: /Création d’entreprise/ })).getByText('Brouillon')).toBeInTheDocument();
  });

  it('filters by status with the segmented control', async () => {
    const user = await renderBrowser();
    expect(titles()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Brouillons' }));
    expect(titles().join()).toMatch(/Création/);
    expect(titles()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Validées' }));
    expect(titles()).toHaveLength(2);
    expect(titles().join()).toMatch(/passeport/i);
    await user.click(screen.getByRole('button', { name: 'Toutes' }));
    expect(titles()).toHaveLength(4);
  });

  it('starts on the status given by ?status=draft', async () => {
    await renderBrowser({ initialStatus: parseStatusFilter('draft') });
    expect(titles()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Brouillons' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows ?stale=1 as a removable chip and keeps only sources older than 90 days', async () => {
    const user = await renderBrowser({ initialStale: true });
    expect(titles()).toHaveLength(2);
    expect(titles().join()).toMatch(/Casier/);
    await user.click(screen.getByRole('button', { name: /Source de plus de 90 jours/ }));
    expect(titles()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /Source de plus de 90 jours/ })).toBeNull();
  });

  it('searches the loaded fiches by title or id', async () => {
    const user = await renderBrowser();
    await user.type(screen.getByLabelText('Rechercher une fiche'), 'CASIER');
    expect(titles()).toHaveLength(1);
    await user.clear(screen.getByLabelText('Rechercher une fiche'));
    await user.type(screen.getByLabelText('Rechercher une fiche'), 'creation-ent');
    expect(titles()).toHaveLength(1);
    await user.clear(screen.getByLabelText('Rechercher une fiche'));
    await user.type(screen.getByLabelText('Rechercher une fiche'), 'zzz');
    expect(screen.getByText('Aucune fiche chargée ne correspond à ces filtres.')).toBeInTheDocument();
  });

  it('keeps cursor pagination: « Charger plus » appends the next page', async () => {
    const user = await renderBrowser({}, [[passeport], [casier]]);
    expect(titles()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(await screen.findByRole('link', { name: /Casier judiciaire/ })).toBeInTheDocument();
    expect(titles()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Charger plus' })).toBeNull();
  });
});

describe('procedure-list helpers', () => {
  it('computes the source age and staleness at the 90 day boundary', () => {
    expect(isStaleSource('2026-08-01T12:00:00Z', NOW)).toBe(false); // 90 jours pile
    expect(isStaleSource('2026-07-31T12:00:00Z', NOW)).toBe(true);
    expect(isStaleSource('n/a', NOW)).toBe(false);
    expect(formatSourceAge('2026-10-30T08:00:00Z', NOW)).toBe('aujourd’hui');
    expect(formatSourceAge('2026-10-29T08:00:00Z', NOW)).toBe('il y a 1 jour');
  });

  it('combines status, stale and search filters', () => {
    const all = [passeport, casier, entreprise, naissance];
    const ids = (f: Parameters<typeof filterProcedures>[1]) => filterProcedures(all, f, NOW).map((p) => p.id);
    expect(ids({ query: '', status: 'draft', stale: true })).toEqual(['acte-naissance']);
    expect(ids({ query: 'passeport', status: 'all', stale: false })).toEqual(['passeport-renouvellement']);
    expect(parseStatusFilter('nope')).toBe('all');
  });
});
