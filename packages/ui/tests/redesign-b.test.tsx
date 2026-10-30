import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Counter, CounterGrid } from '../src/components/Counter';
import { PromptBox } from '../src/components/PromptBox';
import { RebusGlyph } from '../src/components/RebusGlyph';
import { SegmentedControl } from '../src/components/SegmentedControl';
import { SourcePill } from '../src/components/Sources';
import { StepTracker } from '../src/components/StepTracker';
import { Toast } from '../src/components/Toast';

afterEach(() => vi.useRealTimers());

describe('RebusGlyph', () => {
  it('toggles arrow and flag', async () => {
    const user = userEvent.setup();
    render(<RebusGlyph variant="arrow-flag" flag={<i data-testid="flag" />} />);
    await user.click(screen.getByRole('button', { name: 'Afficher le drapeau' }));
    expect(screen.getByTestId('flag')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Afficher la flèche' }));
    expect(screen.queryByTestId('flag')).toBeNull();
  });

  it('cycles through items', async () => {
    const user = userEvent.setup();
    const items = [
      { icon: <i />, label: 'A' },
      { icon: <i />, label: 'B' },
    ];
    render(<RebusGlyph variant="cycle" items={items} />);
    await user.click(screen.getByRole('button', { name: "Changer d'exemple : A" }));
    await user.click(screen.getByRole('button', { name: "Changer d'exemple : B" }));
    expect(screen.getByRole('button', { name: "Changer d'exemple : A" })).toBeInTheDocument();
  });
});

describe('PromptBox', () => {
  it('submits trimmed text on Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PromptBox label="Message" onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Message'), '  bonjour  {Enter}');
    expect(onSubmit).toHaveBeenCalledWith('bonjour');
  });

  it('does not submit on Shift+Enter or when empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PromptBox label="Message" onSubmit={onSubmit} />);
    const box = screen.getByLabelText('Message');
    await user.type(box, '   {Enter}');
    await user.clear(box);
    await user.type(box, 'a{Shift>}{Enter}{/Shift}b');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box).toHaveValue('a\nb');
  });

  it('disables send when empty', async () => {
    const user = userEvent.setup();
    render(<PromptBox label="Message" onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    await user.type(screen.getByLabelText('Message'), 'x');
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeEnabled();
  });

  it('renders compact and optional buttons only when provided', () => {
    const { rerender } = render(<PromptBox label="Message" variant="compact" onSubmit={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Joindre un fichier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dicter' })).toBeNull();
    rerender(<PromptBox label="Message" variant="compact" onSubmit={() => {}} onAttach={() => {}} onMicrophone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Joindre un fichier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dicter' })).toBeInTheDocument();
  });
});

describe('SourcePill', () => {
  it('renders an external link', () => {
    render(<SourcePill index={1} title="Service-Public" domain="service-public.bj" href="https://service-public.bj" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('(nouvel onglet)');
  });
});

describe('StepTracker', () => {
  it('marks the current step and announces statuses', () => {
    render(
      <StepTracker
        steps={[
          { label: 'Un', status: 'done' },
          { label: 'Deux', status: 'current' },
          { label: 'Trois', status: 'todo' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[0]).toHaveTextContent('terminé');
    expect(items[1]).toHaveTextContent('en cours');
    expect(items[2]).toHaveTextContent('à venir');
  });
});

describe('SegmentedControl', () => {
  it('reflects value and notifies changes', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Période"
        options={[
          { value: 'a', label: 'Jour' },
          { value: 'b', label: 'Semaine' },
        ]}
        value="a"
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByRole('group', { name: 'Période' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jour' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Semaine' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
  });
});

describe('Toast', () => {
  it('auto-dismisses after 3200ms', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Enregistré" onDismiss={onDismiss} />);
    expect(screen.getByRole('status')).toHaveTextContent('Enregistré');
    act(() => void vi.advanceTimersByTime(3199));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without message', () => {
    render(<Toast message={null} onDismiss={() => {}} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Counter', () => {
  it('renders number, label and caption', () => {
    render(
      <CounterGrid>
        <Counter value="1 204" label="Questions" caption="ce mois" tone="trust" />
      </CounterGrid>,
    );
    expect(screen.getByText('1 204')).toBeInTheDocument();
    expect(screen.getByText('Questions')).toBeInTheDocument();
    expect(screen.getByText('ce mois')).toBeInTheDocument();
  });
});
