import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from '@/components/audit/audit-log';
import { ConversationBrowser } from '@/components/conversations/conversation-browser';
import { auditKind, availableAuditFilters } from '@/lib/audit-filter';
import { formatRelative } from '@/lib/relative-time';
import { stubC3 } from './helpers/c3-fetch';

const NOW = new Date('2026-10-30T12:00:00Z');
const entry = (id: string, action: string, at = '2026-10-30T11:00:00Z') => ({
  id,
  actorRef: 'adm_ab12',
  action,
  resourceId: `procedure/${id}`,
  at,
  traceId: `4bf92f3577b34da6a3ce929d0e0e47${id.padStart(2, '0')}`,
});

afterEach(() => vi.unstubAllGlobals());

describe('AuditLog', () => {
  it('hides « MCP » and « Suppressions » when no loaded entry matches', async () => {
    stubC3({ lists: { audit: [[entry('1', 'configuration.changed.updated'), entry('2', 'configuration.changed.created')]] } });
    render(<AuditLog now={NOW} />);
    await screen.findByText('procedure/1');
    const group = screen.getByRole('group', { name: 'Filtrer le journal' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Tout', 'Configuration']);
  });

  it('offers MCP and Suppressions when present and filters client-side by prefix', async () => {
    stubC3({
      lists: {
        audit: [
          [
            entry('1', 'configuration.changed.updated'),
            entry('2', 'mcp.permission.updated'),
            entry('3', 'configuration.changed.deleted'),
          ],
        ],
      },
    });
    render(<AuditLog now={NOW} />);
    await screen.findByText('procedure/1');
    const group = screen.getByRole('group', { name: 'Filtrer le journal' });
    await waitFor(() =>
      expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Tout', 'Configuration', 'MCP', 'Suppressions']),
    );
    const user = userEvent.setup();
    const rows = () => within(screen.getByRole('table', { name: 'Journal d’audit' })).getAllByRole('row').slice(1);
    expect(rows()).toHaveLength(3);
    await user.click(within(group).getByRole('button', { name: 'MCP' }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('mcp.permission.updated');
    await user.click(within(group).getByRole('button', { name: 'Suppressions' }));
    expect(rows()[0]).toHaveTextContent('configuration.changed.deleted');
    await user.click(within(group).getByRole('button', { name: 'Configuration' }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('configuration.changed.updated');
  });

  it('colours the action pill (grey, red for .deleted) and copies the trace id', async () => {
    const user = userEvent.setup(); // installs the clipboard stub
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    stubC3({ lists: { audit: [[entry('1', 'configuration.changed.updated'), entry('3', 'configuration.changed.deleted')]] } });
    render(<AuditLog now={NOW} />);
    await screen.findByText('procedure/1');
    expect(screen.getByText('configuration.changed.updated')).toHaveClass('bg-sunken');
    expect(screen.getByText('configuration.changed.deleted')).toHaveClass('bg-danger-soft');
    const traceId = entry('1', 'x').traceId;
    await act(async () => {
      await user.click(screen.getByRole('button', { name: `Copier la trace ${traceId}` }));
    });
    expect(writeText).toHaveBeenCalledWith(traceId);
    expect(await screen.findByRole('button', { name: 'Trace copiée' })).toBeInTheDocument();
    expect(screen.getAllByText('il y a 1 h')).toHaveLength(2);
  });

  it('classifies actions by prefix', () => {
    expect(auditKind('mcp.discovered')).toBe('mcp');
    expect(auditKind('configuration.changed.deleted')).toBe('deleted');
    expect(auditKind('configuration.changed.created')).toBe('configuration');
    expect(availableAuditFilters([])).toEqual(['all', 'configuration']);
  });
});

describe('ConversationBrowser', () => {
  const conversations = [
    { id: 'cnv_1', userRef: 'usr_0123456789abcdef', channel: 'whatsapp', locale: 'fr-BJ', createdAt: '2026-10-30T11:55:00Z' },
    { id: 'cnv_2', userRef: 'usr_zzz', channel: 'web', locale: 'fr', createdAt: '2026-10-28T08:00:00Z' },
  ];

  it('lists cards and shows the metadata tile « Transcription bientôt disponible » for the selected one', async () => {
    stubC3({ lists: { conversations: [conversations] } });
    render(<ConversationBrowser now={NOW} />);
    const card = await screen.findByRole('button', { name: /cnv_1/ });
    expect(within(card).getByText('WhatsApp')).toBeInTheDocument();
    expect(within(card).getByText('il y a 5 min')).toBeInTheDocument();
    expect(within(card).getByText('cnv_1')).toHaveClass('font-mono');
    expect(screen.getByText('Sélectionnez une conversation pour voir ses métadonnées.')).toBeInTheDocument();
    await userEvent.setup().click(card);
    expect(screen.getByRole('heading', { name: 'Transcription bientôt disponible' })).toBeInTheDocument();
    expect(screen.getByText('Pseudonymisé · pièces masquées')).toBeInTheDocument();
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps cursor pagination', async () => {
    stubC3({ lists: { conversations: [[conversations[0]], [conversations[1]]] } });
    render(<ConversationBrowser now={NOW} />);
    await screen.findByRole('button', { name: /cnv_1/ });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(await screen.findByRole('button', { name: /cnv_2/ })).toBeInTheDocument();
  });
});

describe('formatRelative', () => {
  it('speaks in minutes, hours, days then a short date', () => {
    expect(formatRelative('2026-10-30T11:59:40Z', NOW)).toBe('à l’instant');
    expect(formatRelative('2026-10-30T09:00:00Z', NOW)).toBe('il y a 3 h');
    expect(formatRelative('2026-10-29T09:00:00Z', NOW)).toBe('hier');
    expect(formatRelative('2026-10-26T09:00:00Z', NOW)).toBe('il y a 4 jours');
    expect(formatRelative('2026-09-01T09:00:00Z', NOW)).toMatch(/01\/09\/2026/);
  });
});
