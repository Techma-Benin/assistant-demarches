process.env.TZ = 'UTC';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityLog } from '@/components/work/activity-log';
import { UnansweredList } from '@/components/work/unanswered-list';
import { UsersList } from '@/components/work/users-list';
import { json } from './helpers/c3-fetch';
import { resetConsole, stubFetch } from './helpers/work';

vi.mock('@/components/console/console-context', async () => {
  const helpers = await import('./helpers/work');
  return { useConsole: () => helpers.consoleStub };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => resetConsole());
afterEach(() => vi.unstubAllGlobals());

describe('Sans réponse', () => {
  const entry = {
    id: 'una_1',
    conversationId: 'cnv_1',
    messageId: 'msg_1',
    reason: 'no_source',
    status: 'open',
    createdAt: '2026-10-30T10:00:00Z',
    resolvedAt: null,
  };

  it('lists ids and resolves an entry with an Idempotency-Key', async () => {
    const { calls } = stubFetch((call) =>
      call.method === 'POST' ? json({ id: 'una_1', status: 'resolved' }) : json({ items: [entry], nextCursor: null }),
    );
    render(<UnansweredList />);
    expect(await screen.findByText('no_source')).toBeInTheDocument();
    expect(screen.getByText('cnv_1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Marquer résolu' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Question marquée comme résolue.');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url.pathname).toBe('/api/admin/v1/admin/unanswered/una_1/resolve');
    expect(post.headers['idempotency-key']).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Marquer résolu' })).not.toBeInTheDocument();
    expect(screen.getByText('Résolu')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    stubFetch(() => json({ items: [], nextCursor: null }));
    render(<UnansweredList />);
    expect(await screen.findByText('Aucune question sans réponse')).toBeInTheDocument();
  });
});

describe('Journal d’audit', () => {
  it('lists the activity with ids and a copy button for the trace', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const traceId = '11111111111111111111111111111111';
    stubFetch(() =>
      json({
        items: [
          {
            id: 'act_1',
            requestId: 'req_1',
            revision: 4,
            actorRef: 'usr_1',
            action: 'claim',
            outcome: 'applied',
            traceId,
            at: '2026-10-30T10:00:00Z',
          },
        ],
        nextCursor: null,
      }),
    );
    render(<ActivityLog />);
    expect(await screen.findByText('claim')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'req_1' })).toHaveAttribute('href', '/dossiers/req_1');
    await userEvent.click(screen.getByRole('button', { name: `Copier la trace ${traceId}` }));
    expect(writeText).toHaveBeenCalledWith(traceId);
    expect(await screen.findByRole('status')).toHaveTextContent('Trace copiée.');
  });
});

describe('Utilisateurs', () => {
  it('lists users read-only with role, status and departments', async () => {
    const { calls } = stubFetch(() =>
      json({
        items: [
          {
            subject: 'sub_1',
            displayName: 'Awa Dossou',
            email: 'awa@example.bj',
            active: true,
            superAdmin: false,
            memberships: [{ departmentId: 'justice', role: 'agent', active: true }],
            revision: 1,
            createdAt: '2026-10-01T00:00:00Z',
            updatedAt: '2026-10-01T00:00:00Z',
          },
        ],
        nextCursor: null,
      }),
    );
    render(<UsersList />);
    expect(await screen.findByText('Awa Dossou')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Actif', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Justice')).toBeInTheDocument();
    expect(screen.getByText(/Lecture seule/)).toBeInTheDocument();
    expect(calls[0]!.url.searchParams.get('departmentId')).toBe('justice');
  });
});
