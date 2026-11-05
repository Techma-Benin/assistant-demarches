import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('selecting a showcase document then asking sends its question', async () => {
    const onAsk = vi.fn();
    render(<FrontDoor onAsk={onAsk} config={base} />);
    const user = userEvent.setup();
    const passport = screen.getByRole('button', { name: 'Passeport' });
    expect(passport).toHaveAttribute('aria-pressed', 'false');
    await user.click(passport);
    expect(passport).toHaveAttribute('aria-pressed', 'true');
    // The showcase button comes first; the catalogue has its own.
    await user.click(screen.getAllByRole('button', { name: 'Demander à l’assistant' })[0]!);
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Comment renouveler mon passeport ?');
  });

  it('a catalogue item calls onAsk with its question', async () => {
    const onAsk = vi.fn();
    render(<FrontDoor onAsk={onAsk} config={base} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Justice/ }));
    await user.click(screen.getByRole('button', { name: /Légalisation de signature/ }));
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Comment faire légaliser une signature ?');
  });

  it('lists the residence certificate in the showcase and the catalogue', async () => {
    const onAsk = vi.fn();
    render(<FrontDoor onAsk={onAsk} config={base} />);
    // The catalogue shows the Identité theme first.
    expect(screen.getAllByRole('button', { name: /Certificat de résidence/ }).length).toBeGreaterThanOrEqual(2);
    await userEvent.setup().click(screen.getAllByRole('button', { name: /Certificat de résidence/ }).at(-1)!);
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Comment obtenir un certificat de résidence ?');
  });

  it('shows the trust board', () => {
    render(<FrontDoor onAsk={() => {}} config={base} />);
    expect(screen.getByText('Voir votre NPI')).toBeInTheDocument();
    expect(screen.getAllByText(/Chaque information administrative cite sa fiche officielle/).length).toBeGreaterThan(0);
  });

  describe('« Poser ma question »', () => {
    const scroll = vi.fn();
    beforeEach(() => {
      scroll.mockReset();
      Element.prototype.scrollIntoView = scroll;
    });

    it('the hero button scrolls to the question box and focuses it', async () => {
      render(<FrontDoor onAsk={() => {}} config={base} />);
      const [hero] = screen.getAllByRole('button', { name: 'Poser ma question' });
      await userEvent.setup().click(hero!);
      expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
      expect(screen.getByLabelText('Votre question')).toHaveFocus();
    });

    it('the closing button does the same', async () => {
      render(<FrontDoor onAsk={() => {}} config={base} />);
      const buttons = screen.getAllByRole('button', { name: 'Poser ma question' });
      await userEvent.setup().click(buttons.at(-1)!);
      expect(scroll).toHaveBeenCalled();
      expect(screen.getByLabelText('Votre question')).toHaveFocus();
    });

    it('the question box is in the hero, the first thing seen', () => {
      const { container } = render(<FrontDoor onAsk={() => {}} config={base} />);
      const hero = container.querySelector('#top') as HTMLElement;
      expect(within(hero).getByLabelText('Votre question')).toBeInTheDocument();
      expect(container.querySelector('#question')).toBeNull();
    });
  });

  it('shows a resume banner with a Reprendre button', async () => {
    const onResume = vi.fn();
    render(<FrontDoor onAsk={() => {}} config={base} resume={{ title: 'Mon acte', at: new Date().toISOString(), onResume }} />);
    expect(screen.getByText(/Conversation en cours : « Mon acte »/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reprendre' }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('does nothing when disabled', async () => {
    const onAsk = vi.fn();
    render(<FrontDoor onAsk={onAsk} disabled config={base} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Renouveler mon passeport' }));
    await user.click(screen.getByRole('tab', { name: /Justice/ }));
    await user.click(screen.getByRole('button', { name: /Légalisation de signature/ }));
    expect(screen.getAllByRole('button', { name: 'Demander à l’assistant' }).every((b) => b.hasAttribute('disabled'))).toBe(true);
    expect(screen.getByRole('button', { name: /Légalisation de signature/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Votre question'), 'abc{Enter}');
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
  });

  it('no longer mentions WhatsApp, whatever the config', () => {
    render(<FrontDoor onAsk={() => {}} config={{ ...base, whatsappNumber: '+229 01 02 03 04' }} />);
    expect(document.body.textContent).not.toContain('WhatsApp');
    expect(document.querySelector('#whatsapp')).toBeNull();
    expect(document.querySelector('#commencer')).not.toBeNull();
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

  it('credits every photo in the footer', () => {
    render(<FrontDoor onAsk={() => {}} config={base} />);
    const footer = document.querySelector('footer') as HTMLElement;
    expect(within(footer).getByText('Crédits photos').closest('details')).not.toHaveAttribute('open');
    const links = within(footer).getAllByRole('link', { name: /^«.*»$/ });
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Le_monument_de_l%27Amazone.jpg');
  });

  describe('attachments and voice from the hero box', () => {
    afterEach(() => vi.unstubAllGlobals());
    const pdf = () => new File(['x'], 'acte.pdf', { type: 'application/pdf' });
    const heroInput = (container: HTMLElement) => container.querySelector('input[type=file]') as HTMLInputElement;

    it('offers attach and the mic when the box is empty', async () => {
      class FakeRecorder {
        static isTypeSupported = () => true;
      }
      vi.stubGlobal('MediaRecorder', FakeRecorder);
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => Promise.resolve({}) }, configurable: true });
      render(<FrontDoor onAsk={() => {}} config={base} />);
      expect(await screen.findByRole('button', { name: 'Dicter un message' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Joindre un fichier' })).toBeInTheDocument();
    });

    it('sends a staged file with the typed note through onFiles', async () => {
      const onFiles = vi.fn();
      const onAsk = vi.fn();
      const { container } = render(<FrontDoor onAsk={onAsk} onFiles={onFiles} config={base} />);
      const user = userEvent.setup();
      const file = pdf();
      await user.upload(heroInput(container), file);
      await user.type(screen.getByLabelText('Votre question'), 'Mon acte{Enter}');
      expect(onFiles).toHaveBeenCalledExactlyOnceWith([file], 'Mon acte');
      expect(onAsk).not.toHaveBeenCalled();
    });

    it('shares the staged file with the docked box', async () => {
      const { container } = render(<FrontDoor onAsk={() => {}} config={base} />);
      await userEvent.setup().upload(heroInput(container), pdf());
      const docks = document.querySelectorAll('[data-shown]');
      expect(docks).toHaveLength(1);
      expect(within(docks[0] as HTMLElement).getByText('acte.pdf')).toBeInTheDocument();
    });
  });
});
