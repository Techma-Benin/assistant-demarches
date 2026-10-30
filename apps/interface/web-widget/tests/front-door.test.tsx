import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FrontDoor } from '@/components/home/FrontDoor';
import type { SiteConfig } from '@/lib/site-config';

const base: SiteConfig = { brandFlag: true, whatsappNumber: null, reportUrl: null, privacyUrl: null };

describe('FrontDoor', () => {
  it('submits the trimmed PromptBox text', async () => {
    const onAsk = vi.fn();
    render(<FrontDoor onAsk={onAsk} config={base} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Votre question'), '  Mon passeport  {Enter}');
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Mon passeport');
  });

  it.each(['Comment obtenir un casier judiciaire ?', 'Renouveler mon passeport', 'Déclarer une naissance', 'Créer mon entreprise'])(
    'chip %s calls onAsk with its label',
    async (label) => {
      const onAsk = vi.fn();
      render(<FrontDoor onAsk={onAsk} config={base} />);
      await userEvent.setup().click(screen.getByRole('button', { name: label }));
      expect(onAsk).toHaveBeenCalledExactlyOnceWith(label);
    },
  );

  it('a theme card calls onAsk', async () => {
    const onAsk = vi.fn();
    render(<FrontDoor onAsk={onAsk} config={base} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Justice/ }));
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Quelles démarches pour : Justice ?');
  });

  it('does nothing when disabled', async () => {
    const onAsk = vi.fn();
    render(<FrontDoor onAsk={onAsk} disabled config={base} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Renouveler mon passeport' }));
    await user.click(screen.getByRole('button', { name: /Identité/ }));
    await user.type(screen.getByLabelText('Votre question'), 'abc{Enter}');
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
  });

  it('shows the WhatsApp number only when configured, never the placeholder', () => {
    const { unmount } = render(<FrontDoor onAsk={() => {}} config={base} />);
    expect(document.body.textContent).not.toContain('Écrivez au');
    expect(document.body.textContent).not.toContain('[+229');
    unmount();
    render(<FrontDoor onAsk={() => {}} config={{ ...base, whatsappNumber: '+229 01 02 03 04' }} />);
    expect(screen.getByText(/Écrivez au \+229 01 02 03 04/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('[+229 numéro');
  });

  it('renders report/privacy links only when configured', () => {
    const { unmount } = render(<FrontDoor onAsk={() => {}} config={base} />);
    expect(screen.queryByRole('link', { name: 'Signaler un problème' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Confidentialité' })).toBeNull();
    unmount();
    render(<FrontDoor onAsk={() => {}} config={{ ...base, reportUrl: 'https://x.test/r', privacyUrl: 'https://x.test/p' }} />);
    expect(screen.getByRole('link', { name: 'Signaler un problème' })).toHaveAttribute('href', 'https://x.test/r');
    expect(screen.getByRole('link', { name: 'Confidentialité' })).toHaveAttribute('href', 'https://x.test/p');
  });

  it('shows the title and the brand flag', () => {
    const { container } = render(<FrontDoor onAsk={() => {}} config={base} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vos démarches, simplement.');
    expect(container.querySelector('header a svg')).not.toBeNull();
  });

  it('brandFlag false hides the flag in the brand mark', () => {
    const { container } = render(<FrontDoor onAsk={() => {}} config={{ ...base, brandFlag: false }} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vos démarches, simplement.');
    expect(container.querySelector('header a svg')).toBeNull();
  });

  it('keeps the mandatory footer lines', () => {
    render(<FrontDoor onAsk={() => {}} config={base} />);
    expect(screen.getByText('L’IA peut se tromper.')).toBeInTheDocument();
    expect(screen.getByText(/Assistant Démarches est une proposition de Techma Bénin/)).toBeInTheDocument();
  });
});
