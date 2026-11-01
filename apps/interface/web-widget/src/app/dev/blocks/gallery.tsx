'use client';

import { useState, type ReactNode } from 'react';
import { ThemeToggle } from '@techma/ui';
import type { components } from '@techma/contracts-ts';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { ConsentCard } from '@/components/chat/ConsentCard';
import type { ConsentFlow } from '@/lib/consent';
import { noopConsent } from '@/lib/consent';
import { fixtures } from '@/dev/fixtures';
import { formatFileSize } from '@/lib/files';

type Block = components['schemas']['Block'];
type RequestStatus = components['schemas']['RequestStatus'];

const STATUSES: RequestStatus[] = [
  'draft',
  'ready',
  'awaiting_user_validation',
  'submitted',
  'processing',
  'completed',
  'rejected',
  'cancelled',
];

const baseSource = (fixtures[0].blocks[0] as Extract<Block, { type: 'text' }>).sources[0];
const baseCard = fixtures[5].blocks[0] as Extract<Block, { type: 'statusCard' }>;

type Case = { title: string; block: Block; interactive?: boolean };

const CASES: Case[] = [
  ...fixtures.flatMap((message, m) =>
    message.blocks.map((block, b) => ({ title: `Fixture ${m + 1}.${b + 1} · ${block.type}`, block })),
  ),
  {
    title: 'text · deux sources',
    block: {
      type: 'text',
      text: 'Une réponse citant deux sources de démonstration.',
      sources: [baseSource, { ...baseSource, procedureId: 'autre-procedure', version: 'demo-2' }],
    },
  },
  {
    title: 'text · liste ordonnée',
    block: {
      type: 'text',
      text: 'Voici les étapes de la fiche de démonstration :\n1. Remplir la demande en ligne\n2. Joindre votre pièce d’identité\n3. Régler les frais',
      sources: [baseSource],
    },
  },
  {
    title: 'text · source avec URL non sûre (pas de lien)',
    block: { type: 'text', text: 'Source non cliquable.', sources: [{ ...baseSource, url: 'javascript:alert(1)' }] },
  },
  { title: 'buttons · inactifs (message ancien)', block: fixtures[2].blocks[0], interactive: false },
  { title: 'form · inactif (message ancien)', block: fixtures[3].blocks[0], interactive: false },
  { title: 'fileRequest · inactif (message ancien)', block: fixtures[4].blocks[0], interactive: false },
  ...STATUSES.map((status) => ({
    title: `statusCard · ${status}`,
    block: { type: 'statusCard', request: { ...baseCard.request, status } } as Block,
  })),
  {
    title: 'statusCard · awaiting_user_validation sans lien',
    block: { type: 'statusCard', request: { ...baseCard.request, officialLink: null } },
  },
];

const consentChallenge = () => ({
  id: 'chl_DEMO',
  procedureId: baseSource.procedureId,
  scopes: ['requests:write', 'documents:write', 'requests:submit'] as ('requests:write' | 'documents:write' | 'requests:submit')[],
  consentText:
    'J’autorise l’assistant à préparer votre demande, à y joindre vos pièces et à la transmettre pour validation. <b>Texte</b> affiché tel quel.',
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
});
const consentMandate = () => ({ id: 'mdt_DEMO', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });

const CONSENT_CASES: { title: string; flow: ConsentFlow }[] = [
  { title: 'consent · en attente', flow: { phase: 'pending', challenge: consentChallenge() } },
  { title: 'consent · active', flow: { phase: 'active', mandate: consentMandate() } },
  { title: 'consent · refusée', flow: { phase: 'refused' } },
  {
    title: 'consent · expirée',
    flow: { phase: 'pending', challenge: { ...consentChallenge(), expiresAt: new Date(Date.now() - 60_000).toISOString() } },
  },
  { title: 'consent · plus valable (403/409)', flow: { phase: 'invalid' } },
  {
    title: 'consent · erreur',
    flow: { phase: 'error', during: 'accept', message: 'Impossible d’enregistrer votre autorisation pour le moment.' },
  },
  { title: 'consent · démarche inconnue', flow: { phase: 'noProcedure' } },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h2 className="font-mono text-[13px] font-semibold text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

export function BlocksGallery() {
  const [log, setLog] = useState<string[]>([]);
  const push = (line: string) => setLog((previous) => [...previous, line]);

  return (
    <main className="mx-auto flex max-w-[820px] flex-col gap-6 bg-canvas p-4 text-ink md:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-extrabold">Galerie des blocs (dev)</h1>
        <ThemeToggle />
      </div>
      {CASES.map(({ title, block, interactive = true }, index) => (
        <Section key={index} title={title}>
          <BlockRenderer
            block={block}
            interactive={interactive}
            onButton={(item) => push(`button: ${item.id}`)}
            onForm={(formId, values, summary) => push(`form ${formId}: ${JSON.stringify(values)} (${summary})`)}
            onFiles={(files) => push(`fichiers: ${files.map((file) => `${file.name} (${formatFileSize(file.size)})`).join(', ')}`)}
          />
        </Section>
      ))}
      {CONSENT_CASES.map(({ title, flow }) => (
        <Section key={title} title={title}>
          <ConsentCard
            consent={{
              ...noopConsent,
              flow,
              accept: () => push('consent: accepter'),
              refuse: () => push('consent: refuser'),
              renew: () => push('consent: redemander'),
              retry: () => push('consent: réessayer'),
              retract: () => push('consent: retirer'),
              resume: () => push('consent: reprendre'),
            }}
          />
        </Section>
      ))}
      <section aria-label="Journal des callbacks" className="border-t border-line pt-4">
        <h2 className="font-semibold">Journal</h2>
        <ul className="text-[13px] text-ink-muted">
          {log.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
