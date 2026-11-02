import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleProvider, useConsole } from '@/components/admin/console/console-context';
import { ADMIN, AGENT, ANIP, JUSTICE, OFFICIAL_ID, SANTE, SUPER, SUPER_ME, me, official, stubConsole } from './helpers/fixtures';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

function Probe() {
  const c = useConsole();
  return (
    <div>
      <p data-testid="p">
        {c.loading
          ? 'loading'
          : `${c.administrationId ?? 'none'}|${c.isSuperAdmin}|${c.scopeId ?? '-'}|${c.administrations.map((a) => a.id).join(',')}`}
      </p>
      <p data-testid="names">
        {c.profile ? `${c.officialName(OFFICIAL_ID)}/${c.officialName('off_01JD0000000000000000000009')}` : ''}
      </p>
      <p data-testid="perms">{c.profile ? ['cases:act', 'officials:manage'].map((p) => `${p}=${c.can(p as never)}`).join(',') : ''}</p>
    </div>
  );
}

const renderProbe = (initialAdministrationId: string | null) =>
  render(
    <ConsoleProvider initialAdministrationId={initialAdministrationId}>
      <Probe />
    </ConsoleProvider>,
  );

describe('ConsoleProvider administration rule', () => {
  it('gives an agent their own administration, ignoring the cookie, and lets the server force the scope', async () => {
    const { calls } = stubConsole({ me: me(AGENT), administrations: [JUSTICE, ANIP] });
    renderProbe('anip');
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('justice|false|-|justice'));
    expect(calls.some((c) => c.url.includes('/administrations'))).toBe(false);
  });

  it('defaults a super admin to the first connected administration and sends it as scope', async () => {
    stubConsole({ me: SUPER_ME, administrations: [SANTE, JUSTICE, ANIP] });
    renderProbe(null);
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('justice|true|justice|sante,justice,anip'));
  });

  it('honours the cookie for a super admin when connected', async () => {
    stubConsole({ me: SUPER_ME, administrations: [JUSTICE, ANIP] });
    renderProbe('anip');
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('anip|true|anip'));
  });

  it('never selects an administration that is not connected', async () => {
    stubConsole({ me: SUPER_ME, administrations: [SANTE, JUSTICE] });
    renderProbe('sante');
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('justice|true|justice'));
  });

  it('has no administration when none is connected', async () => {
    stubConsole({ me: SUPER_ME, administrations: [SANTE] });
    renderProbe(null);
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('none|true|-|sante'));
  });

  it('exposes can() from the permissions of /me', async () => {
    stubConsole({ me: me(AGENT) });
    renderProbe(null);
    await waitFor(() => expect(screen.getByTestId('perms')).toHaveTextContent('cases:act=true,officials:manage=false'));
  });
});

describe('official names', () => {
  it('uses GET /officials with officials:read, scoped to the chosen administration', async () => {
    const { calls } = stubConsole({
      me: me(SUPER, { official: official({ id: 'off_01JD0000000000000000000008', role: 'super_admin' }), administration: null }),
      administrations: [JUSTICE],
      officials: [official({ displayName: 'Camille Agent' })],
    });
    renderProbe(null);
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Camille Agent/Agent 000009'));
    expect(calls.find((c) => c.url.includes('/officials'))?.url).toContain('administrationId=justice');
  });

  it('falls back to « Agent » + short id without officials:read, and names the signed-in person', async () => {
    const { calls } = stubConsole({ me: me(AGENT) });
    renderProbe(null);
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Agent Justice/Agent 000009'));
    expect(calls.some((c) => c.url.includes('/officials'))).toBe(false);
  });

  it('keeps the fallback for an official absent from the list', async () => {
    stubConsole({ me: me(ADMIN) });
    renderProbe(null);
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('Agent Justice/Agent 000009'));
  });
});
