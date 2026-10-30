import { render as baseRender, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { SessionProvider } from '@/components/session/session-context';
import type { Identity, Session } from '@/lib/permissions';

export const platform: Identity = { id: 'idt_platform', kind: 'platform', label: 'Équipe Techma', access: 'write' };
export const adminWrite: Identity = {
  id: 'idt_justice_write',
  kind: 'administration',
  administrationId: 'justice',
  label: 'Ministère de la Justice',
  access: 'write',
};
export const adminRead: Identity = {
  id: 'idt_cotonou_read',
  kind: 'administration',
  administrationId: 'mairie-cotonou',
  label: 'Mairie de Cotonou',
  access: 'read',
};

export function sessionOf(active: Identity, others: Identity[] = []): Session {
  return { displayName: 'Aïcha D.', identities: [active, ...others], activeIdentityId: active.id };
}

export const platformSession = sessionOf(platform);

export function withSession(session: Session | null = platformSession) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SessionProvider initial={session}>{children}</SessionProvider>;
  };
}

/** `render` inside a SessionProvider (platform session unless `session` is given). */
export function render(ui: ReactElement, { session, ...options }: RenderOptions & { session?: Session | null } = {}) {
  return baseRender(ui, { wrapper: withSession(session), ...options });
}
