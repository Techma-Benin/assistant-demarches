import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleProvider, useConsole } from '@/components/console/console-context';
import { ENSEIGNEMENT, JUSTICE, SESSIONS, SUPER, dept, profile, stubConsole } from './helpers/console-fetch';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

function Probe() {
  const c = useConsole();
  return (
    <p data-testid="p">
      {c.loading ? 'loading' : `${c.departmentId ?? 'none'}|${c.isSuperAdmin}|${c.departments.map((d) => d.id).join(',')}`}
    </p>
  );
}

const renderProbe = (initialDepartmentId: string | null, sessionId = 'justice') =>
  render(
    <ConsoleProvider initialSessions={SESSIONS} initialSessionId={sessionId} initialDepartmentId={initialDepartmentId}>
      <Probe />
    </ConsoleProvider>,
  );

describe('ConsoleProvider department rule', () => {
  it('gives an agent their only department, ignoring a cookie for another one', async () => {
    stubConsole({ profile: profile(), departments: [JUSTICE, ENSEIGNEMENT] });
    renderProbe('enseignement');
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('justice|false|justice'));
  });

  it('defaults a super admin to the first department', async () => {
    stubConsole({ profile: SUPER, departments: [JUSTICE, ENSEIGNEMENT] });
    renderProbe(null, 'super');
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('justice|true|justice,enseignement'));
  });

  it('honours the cookie for a super admin when accessible, else falls back to the first', async () => {
    stubConsole({ profile: SUPER, departments: [JUSTICE, ENSEIGNEMENT] });
    const first = renderProbe('enseignement', 'super');
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('enseignement|true'));
    first.unmount();
    stubConsole({ profile: SUPER, departments: [JUSTICE, dept('sante', 'Santé')] });
    renderProbe('inconnu', 'super');
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('justice|true'));
  });

  it('keeps a department granted by the profile even when the directory does not list it', async () => {
    stubConsole({ profile: profile({ departmentIds: ['demo-administration'] }), departments: [] });
    renderProbe(null);
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('demo-administration|false|demo-administration'));
  });

  it('never invents access: no department when none is accessible', async () => {
    stubConsole({ profile: profile({ departmentIds: [] }), departments: [JUSTICE] });
    renderProbe('justice');
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('none|false|'));
  });
});
