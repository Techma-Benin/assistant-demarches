import { describe, expect, it } from 'vitest';
import { can, roleLabel } from '@/lib/admin/permissions';
import {
  ACTIVITY_LABELS,
  CASE_TABS,
  STATUS_LABELS,
  activityActor,
  allowedActions,
  anonymousOfficial,
  completedByLabel,
  formatHours,
  tabFor,
  tabOfStatus,
} from '@/lib/admin/work-format';
import { ADMIN, AGENT, OFFICIAL_ID, SUPER, me } from './helpers/fixtures';

describe('tabs (§8)', () => {
  it('maps En attente, Complété and Rejeté to the pending, completed and rejected views', () => {
    expect(CASE_TABS.map((tab) => [tab.slug, tab.view, tab.title])).toEqual([
      ['en-attente', 'pending', 'En attente'],
      ['complete', 'completed', 'Complété'],
      ['rejete', 'rejected', 'Rejeté'],
    ]);
    expect(tabFor('pending')?.slug).toBe('en-attente');
  });

  it('groups received, in_review and information_requested under En attente', () => {
    for (const status of ['received', 'in_review', 'information_requested'] as const) {
      expect(tabOfStatus(status)?.view).toBe('pending');
    }
    expect(tabOfStatus('completed')?.view).toBe('completed');
    expect(tabOfStatus('rejected')?.view).toBe('rejected');
  });

  it('has no tab for awaiting_payment (listed in view=all only)', () => {
    expect(tabOfStatus('awaiting_payment')).toBeUndefined();
    expect(CASE_TABS.some((tab) => (tab.statuses as readonly string[]).includes('awaiting_payment'))).toBe(false);
  });

  it('has a French label for the six statuses', () => {
    expect(STATUS_LABELS).toEqual({
      awaiting_payment: 'Paiement en attente',
      received: 'Reçu',
      in_review: 'En vérification',
      information_requested: 'Complément demandé',
      completed: 'Complété',
      rejected: 'Rejeté',
    });
  });
});

describe('allowedActions', () => {
  it('follows the transitions of §8', () => {
    expect(allowedActions('received')).toEqual(['claim']);
    expect(allowedActions('in_review')).toEqual(['claim', 'request_information', 'approve', 'reject']);
    expect(allowedActions('information_requested')).toEqual(['reject']);
    for (const status of ['awaiting_payment', 'completed', 'rejected'] as const) expect(allowedActions(status)).toEqual([]);
  });
});

describe('labels', () => {
  it('labels who completed a case', () => {
    expect(completedByLabel({ completedBy: 'assistant' })).toBe('par l’assistant');
    expect(completedByLabel({ completedBy: 'administration' })).toBe('par l’administration');
    expect(completedByLabel({ completedBy: null })).toBeNull();
  });

  it('labels every journal action in French without a dotted code', () => {
    expect(Object.keys(ACTIVITY_LABELS)).toHaveLength(9);
    for (const label of Object.values(ACTIVITY_LABELS)) expect(label).not.toMatch(/\./);
    expect(ACTIVITY_LABELS['case.claimed']).toBe('Dossier pris en charge');
  });

  it('names the actor of a journal entry', () => {
    const name = (id: string) => (id === OFFICIAL_ID ? 'Agent Justice' : anonymousOfficial(id));
    expect(activityActor({ actor: 'administration', officialId: OFFICIAL_ID }, name)).toBe('Agent Justice');
    expect(activityActor({ actor: 'assistant', officialId: null }, name)).toBe('Assistant');
    expect(activityActor({ actor: 'applicant', officialId: null }, name)).toBe('Usager');
    expect(anonymousOfficial(OFFICIAL_ID)).toBe('Agent 000001');
  });

  it('formats the median in hours', () => {
    expect(formatHours(null)).toBe('-');
    expect(formatHours(0.2)).toBe('12 min');
    expect(formatHours(5)).toBe('5 h');
    expect(formatHours(30)).toBe('1 j 6 h');
    expect(formatHours(48)).toBe('2 j');
  });
});

describe('permissions', () => {
  it('reads permissions from /me only', () => {
    expect(can(me(AGENT), 'cases:act')).toBe(true);
    expect(can(me(AGENT), 'officials:read')).toBe(false);
    expect(can(me(ADMIN), 'officials:manage')).toBe(true);
    expect(can(me(ADMIN), 'administrations:all')).toBe(false);
    expect(can(me(SUPER), 'administrations:all')).toBe(true);
    expect(can(null, 'cases:read')).toBe(false);
  });
  it('labels the roles', () => {
    expect([roleLabel('agent'), roleLabel('admin'), roleLabel('super_admin')]).toEqual([
      'Agent',
      'Administrateur',
      'Super administrateur',
    ]);
  });
});
