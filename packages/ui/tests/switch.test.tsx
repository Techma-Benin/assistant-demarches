import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from '../src/index';

describe('Switch', () => {
  it('exposes role switch with aria-checked and a label from children', () => {
    render(<Switch checked>Activé</Switch>);
    expect(screen.getByRole('switch', { name: 'Activé' })).toHaveAttribute('aria-checked', 'true');
  });

  it('accepts an aria-label and toggles through onCheckedChange', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} aria-label="Actif" onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch', { name: 'Actif' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    await userEvent.setup().click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('toggles with the keyboard', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked aria-label="Actif" onCheckedChange={onCheckedChange} />);
    await userEvent.setup().tab();
    await userEvent.setup().keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('does not toggle when disabled', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked aria-label="Actif" disabled onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch', { name: 'Actif' });
    expect(control).toBeDisabled();
    await userEvent.setup().click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('uses token colors for on and off states', () => {
    const { rerender } = render(<Switch checked aria-label="Actif" />);
    expect(screen.getByRole('switch').firstElementChild?.className).toContain('bg-trust');
    rerender(<Switch checked={false} aria-label="Actif" />);
    expect(screen.getByRole('switch').firstElementChild?.className).toContain('bg-[var(--ui-border-strong)]');
  });
});
