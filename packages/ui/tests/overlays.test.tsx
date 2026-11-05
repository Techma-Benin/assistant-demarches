import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, IconButton, Toast, Tooltip } from '../src/index';

function Demo({ onSave = () => {} }: { onSave?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Ajouter un modèle" description="Une description">
          <DialogBody>
            <p>Contenu</p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <button type="button">Annuler</button>
            </DialogClose>
            <button type="button" onClick={onSave}>
              Enregistrer
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('opens as a named modal, closes with Escape and gives the focus back', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const trigger = screen.getByRole('button', { name: 'Ouvrir' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Ajouter un modèle' });
    expect(dialog).toHaveAccessibleDescription('Une description');
    expect(screen.getByText('Contenu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes with the close button and with a DialogClose action', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('runs footer actions', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<Demo onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});

describe('Tooltip', () => {
  it('shows its label when the trigger gets the keyboard focus, without renaming the button', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Modifier">
        <IconButton label="Modifier Groq">x</IconButton>
      </Tooltip>,
    );
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Modifier');
    expect(screen.getByRole('button', { name: 'Modifier Groq' })).toBeInTheDocument();
  });
});

describe('Toast action', () => {
  it('offers a way back that runs then dismisses the message', async () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast message="Activé" onDismiss={onDismiss} action={{ label: 'Annuler', onClick: onUndo }} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
