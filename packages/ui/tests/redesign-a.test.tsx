import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BrandMark } from '../src/components/BrandMark';
import { Button } from '../src/components/Button';
import { FlagGlyph } from '../src/components/FlagGlyph';
import { StatusPill } from '../src/components/StatusPill';
import { Switch } from '../src/components/Switch';
import { Tile } from '../src/components/Tile';
import { TypingIndicator } from '../src/components/TypingIndicator';

describe('FlagGlyph', () => {
  it('is an image with a label by default', () => {
    render(<FlagGlyph />);
    expect(screen.getByRole('img', { name: 'Drapeau du Bénin' })).toBeInTheDocument();
  });

  it('is hidden when decorative', () => {
    const { container } = render(<FlagGlyph decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('BrandMark', () => {
  it('shows the wordmark and the flag', () => {
    const { container } = render(<BrandMark />);
    expect(screen.getByText('Démarches')).toBeVisible();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('hides the flag with showFlag=false', () => {
    const { container } = render(<BrandMark showFlag={false} size="lg" />);
    expect(screen.getByText('Démarches')).toBeVisible();
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Tile', () => {
  it.each([
    ['default', 'bg-sunken'],
    ['ink', 'bg-action'],
    ['sun', 'bg-sun'],
    ['trust', 'bg-trust'],
    ['outline', 'border-line'],
    ['white', 'bg-surface'],
  ] as const)('tone %s', (tone, cls) => {
    render(<Tile tone={tone}>x</Tile>);
    const el = screen.getByText('x');
    expect(el.className).toContain(cls);
    expect(el.className).toContain('rounded-tile');
    expect(el.className).not.toContain('text-sun');
  });

  it('renders as the child with asChild', () => {
    render(
      <Tile asChild>
        <a href="/x">Lien</a>
      </Tile>,
    );
    expect(screen.getByRole('link', { name: 'Lien' }).className).toContain('rounded-tile');
  });
});

describe('StatusPill', () => {
  it.each([
    ['validated', 'text-trust-text'],
    ['draft', 'bg-sun'],
    ['toValidate', 'bg-sun'],
    ['submitted', 'text-on-trust'],
    ['info', 'border-line'],
    ['danger', 'bg-danger-soft'],
  ] as const)('status %s', (status, cls) => {
    render(<StatusPill status={status}>Etat</StatusPill>);
    const el = screen.getByText('Etat');
    expect(el.className).toContain(cls);
    expect(el.className).toContain('rounded-pill');
  });
});

describe('Switch', () => {
  it('uses trust or ink for the on state', () => {
    const { rerender } = render(<Switch checked aria-label="A" />);
    expect(screen.getByRole('switch').firstElementChild?.className).toContain('bg-trust');
    rerender(<Switch checked tone="ink" aria-label="A" />);
    expect(screen.getByRole('switch').firstElementChild?.className).toContain('bg-action');
  });

  it('toggles', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} aria-label="A" onCheckedChange={onCheckedChange} />);
    await userEvent.setup().click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('Button', () => {
  it('has the new variants and sizes', () => {
    const { rerender } = render(<Button variant="outline">Ok</Button>);
    expect(screen.getByRole('button').className).toContain('border-action');
    rerender(<Button variant="trust">Ok</Button>);
    expect(screen.getByRole('button').className).toContain('bg-trust');
    rerender(<Button size="lg">Ok</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-14');
    rerender(<Button>Ok</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-12');
  });
});

describe('TypingIndicator', () => {
  it('keeps its status role and shows three flag-coloured dots', () => {
    const { container } = render(<TypingIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent('L’assistant écrit…');
    expect(container.querySelectorAll('.bg-trust, .bg-sun, .bg-flag-red')).toHaveLength(3);
  });
});
