import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentArt, Stamp, qrModules, type DocumentKind } from '@/components/home/DocumentArt';

const KINDS: DocumentKind[] = ['acte-naissance', 'casier', 'passeport', 'cni', 'entreprise', 'permis', 'residence'];

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

  it('acte de naissance has the dashed cut line', () => {
    const { container } = render(<DocumentArt kind="acte-naissance" />);
    expect(container.querySelector('line[stroke-dasharray="2 2"]')).not.toBeNull();
    expect(container.textContent).toContain('ACTE DE NAISSANCE');
  });

  it('residence shows its title and sections', () => {
    const { container } = render(<DocumentArt kind="residence" />);
    expect(container.textContent).toContain('CERTIFICAT DE RÉSIDENCE');
    expect(container.textContent).toContain('REQUÉRANT');
  });

  it('QR generator is deterministic', () => {
    expect(qrModules(7)).toEqual(qrModules(7));
    expect(qrModules(7)).not.toEqual(qrModules(8));
  });

  it('Stamp is decorative', () => {
    const { container } = render(<Stamp label="Validé" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
