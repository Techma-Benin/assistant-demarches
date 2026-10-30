import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '@/components/chat/Composer';

describe('Composer attach', () => {
  it('calls onFile for a valid file and clears a previous error', async () => {
    const onFile = vi.fn();
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFile={onFile} />);
    const user = userEvent.setup({ applyAccept: false });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'a.txt', { type: 'text/plain' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Format non accepté');
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    await user.upload(input, png);
    expect(onFile).toHaveBeenCalledExactlyOnceWith(png);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rejects an invalid file with an alert', async () => {
    const onFile = vi.fn();
    const { container } = render(<Composer disabled={false} onSend={() => {}} onFile={onFile} />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(container.querySelector('input[type=file]') as HTMLInputElement, new File([], 'e.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Le fichier est vide.');
    expect(onFile).not.toHaveBeenCalled();
  });

  it('sends trimmed text on submit and clears the box', async () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} onSend={onSend} onFile={() => {}} />);
    const user = userEvent.setup();
    const box = screen.getByLabelText('Poser une autre question');
    await user.type(box, '  Bonjour  ');
    await user.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Bonjour');
    expect(box).toHaveValue('');
    expect(screen.getByText(/L’IA peut se tromper/)).toBeInTheDocument();
  });

  it('disables the attach button like the textarea', () => {
    render(<Composer disabled onSend={() => {}} onFile={() => {}} />);
    expect(screen.getByRole('button', { name: 'Joindre un fichier' })).toBeDisabled();
  });
});
