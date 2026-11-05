import { describe, expect, it } from 'vitest';
import { BUSINESS_NAV, dossierNavHref, isActive } from '@/components/admin/shell/nav-items';

const enAttente = BUSINESS_NAV.find((item) => item.href === '/admin/en-attente')!;
const complete = BUSINESS_NAV.find((item) => item.href === '/admin/complete')!;
const rejete = BUSINESS_NAV.find((item) => item.href === '/admin/rejete')!;

describe('isActive on a dossier page', () => {
  it('maps the loaded case status to the queue tab', () => {
    expect(dossierNavHref('completed')).toBe('/admin/complete');
    expect(dossierNavHref('rejected')).toBe('/admin/rejete');
    expect(dossierNavHref('received')).toBe('/admin/en-attente');
    expect(dossierNavHref('in_review')).toBe('/admin/en-attente');
    expect(dossierNavHref('information_requested')).toBe('/admin/en-attente');
    expect(dossierNavHref(null)).toBe('/admin/en-attente');
  });

  it('highlights Complété or Rejeté instead of En attente', () => {
    expect(isActive(complete, '/admin/dossiers/abc', 'completed')).toBe(true);
    expect(isActive(enAttente, '/admin/dossiers/abc', 'completed')).toBe(false);
    expect(isActive(rejete, '/admin/dossiers/abc', 'rejected')).toBe(true);
    expect(isActive(enAttente, '/admin/dossiers/abc', 'rejected')).toBe(false);
    expect(isActive(enAttente, '/admin/dossiers/abc', 'in_review')).toBe(true);
    expect(isActive(complete, '/admin/dossiers/abc', 'in_review')).toBe(false);
  });
});
