import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@techma/contracts-ts';
import { describe, expect, it, vi } from 'vitest';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { fixtures } from '@/dev/fixtures';
import { TextBlock } from '@/components/blocks/TextBlock';

type Block = components['schemas']['Block'];
type RequestStatus = components['schemas']['RequestStatus'];

const noop = () => {};
function renderBlock(block: Block, props: Partial<Parameters<typeof BlockRenderer>[0]> = {}) {
  return render(<BlockRenderer block={block} interactive onButton={noop} onForm={noop} onFiles={noop} {...props} />);
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
      const onFiles = vi.fn();
      renderBlock(block, { onFiles });
      const user = userEvent.setup({ applyAccept: false });
      await user.upload(screen.getByLabelText('Joindre une pièce'), new File(['x'], 'a.txt', { type: 'text/plain' }));
      expect(screen.getByRole('alert')).toHaveTextContent('a.txt : format non accepté');
      expect(onFiles).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Choisir un fichier' })).toBeEnabled();
    });

    it('stages the file and shows its chip without sending', async () => {
      const onFiles = vi.fn();
      renderBlock(block, { onFiles });
      const user = userEvent.setup();
      const file = pdf();
      await user.upload(screen.getByLabelText('Joindre une pièce'), file);
      expect(onFiles).not.toHaveBeenCalled();
      expect(screen.getByTitle('doc.pdf')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Envoyer cette pièce' })).toBeEnabled();
    });

    it('sends several files with « Envoyer les pièces » then disables', async () => {
      const onFiles = vi.fn();
      renderBlock(block, { onFiles });
      const user = userEvent.setup();
      const file = pdf();
      await user.upload(screen.getByLabelText('Joindre une pièce'), file);
      expect(onFiles).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Ajouter une autre pièce' })).toBeEnabled();
      const other = new File(['y'], 'autre.pdf', { type: 'application/pdf' });
      await user.upload(screen.getByLabelText('Joindre une pièce'), other);
      await user.click(screen.getByRole('button', { name: 'Retirer doc.pdf' }));
      await user.upload(screen.getByLabelText('Joindre une pièce'), file);
      await user.click(screen.getByRole('button', { name: 'Envoyer les pièces' }));
      expect(onFiles).toHaveBeenCalledTimes(1);
      expect(onFiles).toHaveBeenCalledWith([other, file]);
      expect(screen.queryByRole('button', { name: 'Choisir un fichier' })).toBeNull();
      expect(screen.getByText(/autre\.pdf · 1 o, doc\.pdf · 8 o/)).toBeInTheDocument();
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
    expect(screen.getByText(/^req_/)).toHaveClass('font-mono');
    unmount();
    renderBlock(statusCard('awaiting_user_validation', 'javascript:alert(1)'));
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    renderBlock(statusCard('draft', null));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('hides the procedure id and offers to copy the reference', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const block = statusCard('draft', null);
    const id = (block as Extract<Block, { type: 'statusCard' }>).request.id;
    renderBlock(block);
    expect(screen.queryByText(/Démarche/)).toBeNull();
    expect(screen.getByText('Référence')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Copier la référence' }));
    expect(writeText).toHaveBeenCalledWith(id);
    expect(await screen.findByText('Copiée')).toBeInTheDocument();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('hides the copy button without Clipboard API', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderBlock(statusCard('draft', null));
    expect(screen.queryByRole('button', { name: 'Copier la référence' })).toBeNull();
  });

  it('opens the portal link of other statuses too', () => {
    renderBlock(statusCard('processing', 'https://example.org/demonstration'));
    expect(screen.getByRole('link', { name: 'Ouvrir le portail officiel' })).toBeInTheDocument();
  });
});

describe('TextBlock progressive reveal', () => {
  const live = (text: string, sources: Extract<Block, { type: 'text' }>['sources'] = []) =>
    render(<TextBlock block={{ type: 'text', text, sources }} revealDelay={70} />);

  it('keeps the full text and wraps words with capped delays', () => {
    const { container } = live('Un deux trois');
    expect(container).toHaveTextContent('Un deux trois');
    const words = Array.from(container.querySelectorAll<HTMLElement>('.chat-word'));
    expect(words.map((w) => w.style.animationDelay)).toEqual(['70ms', '88ms', '106ms']);
  });

  it('spreads long texts within 600 ms', () => {
    const { container } = live(Array(200).fill('mot').join(' '));
    const words = container.querySelectorAll<HTMLElement>('.chat-word');
    expect(words).toHaveLength(200);
    expect(parseInt(words[199].style.animationDelay) - 70).toBeLessThanOrEqual(600);
  });

  it('reveals per paragraph above 400 words, without wrapping words', () => {
    const { container } = live(Array(450).fill('mot').join(' '));
    expect(container.querySelector('.chat-word')).toBeNull();
    expect(container.querySelector('p.chat-reveal')).not.toBeNull();
  });

  it('does not wrap anything without a reveal delay', () => {
    const { container } = render(<TextBlock block={{ type: 'text', text: 'Un deux', sources: [] }} />);
    expect(container.querySelector('.chat-word, .chat-reveal')).toBeNull();
  });
});
