import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, Chip, IconButton, TextField } from '../src/index';

describe('Button', () => {
  it('applies variants', () => {
    const { rerender } = render(<Button>Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('bg-action');
    rerender(<Button variant="secondary">Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('bg-sunken');
    rerender(<Button variant="ghost">Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('hover:bg-sunken');
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('rounded-pill');
  });

  it('renders as the child with asChild', () => {
    render(
      <Button asChild>
        <a href="https://example.org">Lien</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Lien' });
    expect(link).toHaveAttribute('href', 'https://example.org');
    expect(link.className).toContain('bg-action');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Ok
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('IconButton', () => {
  it('uses label as accessible name', () => {
    render(
      <IconButton label="Envoyer">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Envoyer' })).toHaveAttribute('aria-label', 'Envoyer');
  });
});

describe('Chip', () => {
  it('is a plain button without aria-pressed unless selected is provided', () => {
    const { rerender } = render(<Chip>Un</Chip>);
    expect(screen.getByRole('button', { name: 'Un' })).not.toHaveAttribute('aria-pressed');
    rerender(<Chip selected={false}>Un</Chip>);
    expect(screen.getByRole('button', { name: 'Un' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<Chip selected>Un</Chip>);
    expect(screen.getByRole('button', { name: 'Un' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('TextField', () => {
  it('wires error and hint to the input', () => {
    render(<TextField label="Nom" hint="Aide" error="Champ invalide" required />);
    const input = screen.getByLabelText(/Nom/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeRequired();
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy.split(' ')[1])).toHaveTextContent('Champ invalide');
    expect(screen.getByText('(obligatoire)', { exact: false })).toBeInTheDocument();
  });

  it('has no aria-invalid without error', () => {
    render(<TextField label="Nom" />);
    expect(screen.getByLabelText('Nom')).not.toHaveAttribute('aria-invalid');
  });
});
