'use client';

import { useState, type ReactNode } from 'react';
import { ThemeToggle } from '@techma/ui';
import type { components } from '@techma/contracts-ts';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
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
            onFile={(file) => push(`fichier: ${file.name} (${formatFileSize(file.size)})`)}
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
