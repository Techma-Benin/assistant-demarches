import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentArt, Stamp, type DocumentKind } from '@/components/home/DocumentArt';

const KINDS: DocumentKind[] = ['acte-naissance', 'casier', 'passeport', 'cni', 'entreprise', 'permis'];

describe('DocumentArt', () => {
  it.each(KINDS)('%s renders a decorative svg', (kind) => {
    const { container } = render(<DocumentArt kind={kind} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('stamped adds the validated label', () => {
    const { container } = render(<DocumentArt kind="casier" stamped />);
    expect(container.textContent).toContain('Validé');
  });

  it('Stamp is decorative', () => {
    const { container } = render(<Stamp label="Validé" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
