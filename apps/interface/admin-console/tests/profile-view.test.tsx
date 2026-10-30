import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleProvider } from '@/components/console/console-context';
import { ProfileView } from '@/components/console/profile-view';
import { JUSTICE, SESSIONS, SUPER, profile, stubConsole } from './helpers/console-fetch';

vi.mock('next/navigation', () => ({ usePathname: () => '/profil', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const renderView = () =>
  render(
    <ConsoleProvider initialSessions={SESSIONS} initialSessionId="justice" initialDepartmentId={null}>
      <ProfileView />
    </ConsoleProvider>,
  );

describe('ProfileView', () => {
  it('renders an agent profile', async () => {
    stubConsole({ profile: profile({ email: 'camille@example.org' }), departments: [JUSTICE] });
    renderView();
    expect(await screen.findByText('Camille Agent')).toBeInTheDocument();
    expect(screen.getByText('camille@example.org')).toBeInTheDocument();
    expect(screen.queryByText('Super admin')).toBeNull();
    expect(screen.getByText('Justice')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('department:read')).toBeInTheDocument();
    expect(screen.getByText('oidc')).toBeInTheDocument();
    expect(screen.getByText('backend-demo-adapter')).toBeInTheDocument();
  });

  it('renders the super admin badge and admin role', async () => {
    stubConsole({
      profile: { ...SUPER, memberships: [{ departmentId: 'justice', role: 'admin', active: true }] },
      departments: [JUSTICE],
    });
    renderView();
    expect(await screen.findByText('Sam Super')).toBeInTheDocument();
    expect(screen.getByText('Super admin')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });
});
