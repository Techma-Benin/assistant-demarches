import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@techma/contracts-ts';
import { describe, expect, it, vi } from 'vitest';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { fixtures } from '@/dev/fixtures';

type Block = components['schemas']['Block'];
type RequestStatus = components['schemas']['RequestStatus'];

const noop = () => {};
function renderBlock(block: Block, props: Partial<Parameters<typeof BlockRenderer>[0]> = {}) {
  return render(<BlockRenderer block={block} interactive onButton={noop} onForm={noop} onFile={noop} {...props} />);
}
const source = (url: string) => ({
  procedureId: 'p',
  url,
  retrievedAt: '2026-10-22T18:00:00Z',
  version: 'v9',
});
const statusCard = (status: RequestStatus, officialLink: string | null): Block => ({
  type: 'statusCard',
  request: { ...(fixtures[5].blocks[0] as Extract<Block, { type: 'statusCard' }>).request, status, officialLink },
});

describe('BlockRenderer', () => {
  it('renders every fixture without crashing', () => {
    for (const message of fixtures) for (const block of message.blocks) renderBlock(block);
  });

  it('renders text as literal text (no HTML injection)', () => {
    const { container } = renderBlock({ type: 'text', text: '<img src=x onerror=alert(1)>', sources: [] });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('renders sources as safe external links with citation marks', () => {
    renderBlock({ type: 'text', text: 'Info', sources: [source('https://example.org/page'), source('https://example.org/b')] });
    const link = screen.getAllByRole('link', { name: /p · example\.org/ })[0];
    expect(link).toHaveAttribute('href', 'https://example.org/page');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getAllByLabelText(/^Source \d$/)).toHaveLength(2);
  });

  it('shows no pill nor mark without sources', () => {
    renderBlock({ type: 'text', text: 'Bonjour', sources: [] });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByLabelText(/^Source \d$/)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('does not render feedback buttons (no API in the contract)', () => {
    renderBlock({ type: 'text', text: 'Info', sources: [source('https://example.org/page')] });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders ordered lines as numbered tiles and keeps other lines as paragraphs', () => {
    renderBlock({ type: 'text', text: 'Intro\n1. Premier\n2. Second\nFin', sources: [] });
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('1Premier');
    expect(items[1]).toHaveTextContent('2Second');
    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('Fin')).toBeInTheDocument();
  });

  it('does not render a javascript: source as a link', () => {
    renderBlock({ type: 'text', text: 'Info', sources: [source('javascript:alert(1)')] });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('calls onButton once then disables the buttons', async () => {
    const onButton = vi.fn();
    renderBlock(fixtures[2].blocks[0], { onButton });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Démarrer' }));
    await user.click(screen.getByRole('button', { name: 'Démarrer' }));
    expect(onButton).toHaveBeenCalledTimes(1);
    expect(onButton).toHaveBeenCalledWith({ id: 'start-demo', label: 'Démarrer' });
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('submits form values then disables the form', async () => {
    const onForm = vi.fn();
    renderBlock(fixtures[3].blocks[0], { onForm });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Nom affiché/), 'Alice');
    await user.type(screen.getByLabelText(/Nombre de personnes/), '3');
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(onForm).toHaveBeenCalledWith(
      'demo-identity-form',
      { displayName: 'Alice', householdSize: '3', startDate: '' },
      'Formulaire envoyé',
    );
    expect(screen.getByText('Informations enregistrées')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuer' })).toBeNull();
    expect(screen.queryByText(/Étape \d sur/)).toBeNull();
  });

  it('disables controls when not interactive', () => {
    const { unmount } = renderBlock(fixtures[2].blocks[0], { interactive: false });
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    unmount();
    renderBlock(fixtures[3].blocks[0], { interactive: false });
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
    expect(screen.getByLabelText(/Nom affiché/)).toBeDisabled();
  });

  describe('fileRequest', () => {
    const block = fixtures[4].blocks[0];
    const pdf = () => new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });

    it('shows accepted formats and the effective accept attribute', () => {
      renderBlock(block);
      expect(screen.getByText(/PDF, JPEG, PNG · stockée à part, jamais dans la conversation/)).toBeInTheDocument();
      expect(screen.queryByText(/bientôt disponible/)).toBeNull();
      const accepted = (block as Extract<Block, { type: 'fileRequest' }>).acceptedMimeTypes;
      expect(screen.getByLabelText('Joindre une pièce')).toHaveAttribute('accept', accepted.join(','));
    });

    it('shows an alert for an invalid type and stays usable', async () => {
      const onFile = vi.fn();
      renderBlock(block, { onFile });
      const user = userEvent.setup({ applyAccept: false });
      await user.upload(screen.getByLabelText('Joindre une pièce'), new File(['x'], 'a.txt', { type: 'text/plain' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Format non accepté');
      expect(onFile).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Choisir un fichier' })).toBeEnabled();
    });

    it('calls onFile once then disables', async () => {
      const onFile = vi.fn();
      renderBlock(block, { onFile });
      const user = userEvent.setup();
      const file = pdf();
      await user.upload(screen.getByLabelText('Joindre une pièce'), file);
      expect(onFile).toHaveBeenCalledTimes(1);
      expect(onFile).toHaveBeenCalledWith(file);
      expect(screen.queryByRole('button', { name: 'Choisir un fichier' })).toBeNull();
      expect(screen.getByText(/doc\.pdf · 8 o/)).toBeInTheDocument();
      expect(screen.getByLabelText('Joindre une pièce')).toBeDisabled();
    });

    it('is disabled when not interactive', () => {
      renderBlock(block, { interactive: false });
      expect(screen.getByRole('button', { name: 'Choisir un fichier' })).toBeDisabled();
    });
  });

  it.each([
    ['draft', 'Brouillon'],
    ['ready', 'Prête'],
    ['awaiting_user_validation', 'À valider par vous'],
    ['submitted', 'Transmise'],
    ['processing', 'En traitement'],
    ['completed', 'Terminée'],
    ['rejected', 'Rejetée'],
    ['cancelled', 'Annulée'],
  ] as const)('labels status %s', (status, label) => {
    renderBlock(statusCard(status, null));
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/Mise à jour le 22\/10\/2026/)).toBeInTheDocument();
  });

  it('shows the official link only when http(s)', () => {
    const { unmount } = renderBlock(statusCard('awaiting_user_validation', 'https://example.org/demonstration'));
    const link = screen.getByRole('link', { name: 'Valider sur le portail officiel' });
    expect(link).toHaveAttribute('href', 'https://example.org/demonstration');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('heading', { name: 'Votre demande est prête.' })).toBeInTheDocument();
    expect(screen.getByText(/Réf\. req_/)).toHaveClass('font-mono');
    unmount();
    renderBlock(statusCard('awaiting_user_validation', 'javascript:alert(1)'));
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    renderBlock(statusCard('draft', null));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('opens the portal link of other statuses too', () => {
    renderBlock(statusCard('processing', 'https://example.org/demonstration'));
    expect(screen.getByRole('link', { name: 'Ouvrir le portail officiel' })).toBeInTheDocument();
  });
});
