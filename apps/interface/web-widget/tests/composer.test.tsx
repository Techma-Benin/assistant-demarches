import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '@/components/chat/Composer';

const mkPng = () => new File(['x'], 'carte-identite-recto-verso.png', { type: 'image/png' });
const attach = (container: HTMLElement) => container.querySelector('input[type=file]') as HTMLInputElement;

function stubPreview() {
  const proto = HTMLDialogElement.prototype;
  const original = proto.showModal;
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const { createObjectURL, revokeObjectURL } = URL;
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
  return () => {
    proto.showModal = original;
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  };
}

describe('Composer image preview', () => {
  it('opens a full-size preview of a staged image and closes it', async () => {
    const restore = stubPreview();
    try {
      const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
      const user = userEvent.setup({ applyAccept: false });
      const png = mkPng();
      await user.upload(attach(container), png);
      await user.click(await screen.findByRole('button', { name: `Voir ${png.name}` }));
      const dialog = screen.getByRole('dialog', { name: `Aperçu de ${png.name}` });
      expect(within(dialog).getByRole('img', { name: png.name })).toHaveAttribute('src', 'blob:preview');
      await user.click(within(dialog).getByRole('button', { name: 'Fermer l’aperçu' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      restore();
    }
  });

  it('gives a staged PDF no preview button', async () => {
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    await userEvent.setup({ applyAccept: false }).upload(attach(container), new File(['x'], 'acte.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('button', { name: 'Retirer acte.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Voir/ })).toBeNull();
  });
});

describe('Composer attach', () => {
  it('stages a valid file without sending, then sends it with a note', async () => {
    const onFiles = vi.fn();
    const onSend = vi.fn();
    const { container } = render(<Composer disabled={false} onSend={onSend} onFiles={onFiles} />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(attach(container), new File(['x'], 'a.txt', { type: 'text/plain' }));
    expect(screen.getByRole('alert')).toHaveTextContent('a.txt : format non accepté');
    const png = mkPng();
    await user.upload(attach(container), png);
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: `Retirer ${png.name}` })).toBeInTheDocument();
    expect(screen.getByTitle(png.name)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Votre message'), '  Recto  ');
    await user.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([png], 'Recto');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Retirer/ })).toBeNull();
  });

  it('sends a staged file without text, and can remove one of several', async () => {
    const onFiles = vi.fn();
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={onFiles} />);
    const user = userEvent.setup({ applyAccept: false });
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    const first = mkPng();
    await user.upload(attach(container), first);
    await user.click(screen.getByRole('button', { name: `Retirer ${first.name}` }));
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    const pdf = new File(['x'], 'acte.pdf', { type: 'application/pdf' });
    await user.upload(attach(container), first);
    await user.upload(attach(container), pdf);
    expect(screen.getByRole('button', { name: `Retirer ${first.name}` })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([first, pdf], undefined);
  });

  it('stages a dropped file and a pasted file', () => {
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    const box = screen.getByLabelText('Votre message');
    const dropped = new File(['x'], 'drop.pdf', { type: 'application/pdf' });
    const zone = container.querySelector('.relative') as HTMLElement;
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [dropped] } });
    expect(screen.getByText('Déposez vos pièces ici')).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [dropped] } });
    expect(screen.queryByText('Déposez vos pièces ici')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retirer drop.pdf' })).toBeInTheDocument();
    fireEvent.paste(box, { clipboardData: { files: [mkPng()] } });
    expect(screen.getByRole('button', { name: `Retirer ${mkPng().name}` })).toBeInTheDocument();
  });

  it('keeps both files, removes one with its ×, ignores a duplicate', async () => {
    const onFiles = vi.fn();
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={onFiles} />);
    const user = userEvent.setup({ applyAccept: false });
    const a = new File(['x'], 'a.png', { type: 'image/png', lastModified: 1 });
    const b = new File(['y'], 'b.pdf', { type: 'application/pdf', lastModified: 2 });
    await user.upload(attach(container), [a, b]);
    expect(screen.getByRole('button', { name: 'Retirer a.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirer b.pdf' })).toBeInTheDocument();
    await user.upload(attach(container), new File(['x'], 'a.png', { type: 'image/png', lastModified: 1 }));
    expect(screen.getAllByRole('button', { name: /Retirer/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Retirer a.png' }));
    expect(screen.getAllByRole('button', { name: /Retirer/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([b], undefined);
  });

  it('refuses a 6th file with a message', async () => {
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    const user = userEvent.setup({ applyAccept: false });
    const many = Array.from({ length: 6 }, (_, i) => new File(['x'], `p${i}.pdf`, { type: 'application/pdf', lastModified: i }));
    await user.upload(attach(container), many);
    expect(screen.getAllByRole('button', { name: /Retirer/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Retirer p5.pdf' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('5 pièces maximum par envoi');
  });

  it('skips an invalid file by name while valid ones stay', async () => {
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(attach(container), [
      new File(['x'], 'carte.heic', { type: 'image/heic' }),
      new File(['x'], 'ok.png', { type: 'image/png' }),
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('carte.heic : format non accepté');
    expect(screen.getByRole('button', { name: 'Retirer ok.png' })).toBeInTheDocument();
  });

  it('rejects an invalid file with an alert', async () => {
    const onFiles = vi.fn();
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFiles={onFiles} />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(attach(container), new File([], 'e.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('alert')).toHaveTextContent('e.pdf : le fichier est vide.');
    expect(screen.queryByRole('button', { name: /Retirer/ })).toBeNull();
  });

  it('sends trimmed text on submit, clears the box and shows the hint', async () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} onSend={onSend} onFiles={() => {}} />);
    const user = userEvent.setup();
    const box = screen.getByLabelText('Votre message');
    expect(box).toHaveAttribute('placeholder', 'Écrire un message…');
    expect(screen.getByText('PDF, JPG ou PNG · 10 Mo maximum')).toBeInTheDocument();
    expect(screen.queryByText(/L’IA peut se tromper/)).toBeNull();
    await user.type(box, '  Bonjour  ');
    await user.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Bonjour');
    expect(box).toHaveValue('');
  });

  it('shows a counter beyond 3 600 characters', () => {
    render(<Composer disabled={false} onSend={() => {}} onFiles={() => {}} />);
    const box = screen.getByLabelText('Votre message');
    fireEvent.change(box, { target: { value: 'a'.repeat(3600) } });
    expect(screen.queryByText(/\/ 4/)).toBeNull();
    fireEvent.change(box, { target: { value: 'a'.repeat(3950) } });
    expect(screen.getByText(/3\s950 \/ 4\s000/)).toHaveAttribute('aria-live', 'polite');
  });

  it('disables the attach button like the textarea', () => {
    render(<Composer disabled onSend={() => {}} onFiles={() => {}} />);
    expect(screen.getByRole('button', { name: 'Joindre un fichier' })).toBeDisabled();
  });
});
