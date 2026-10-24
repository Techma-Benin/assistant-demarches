'use client';

import { useState, type ReactNode } from 'react';
import {
  Badge,
  BrandMark,
  Button,
  Card,
  Chip,
  IconButton,
  InlineAlert,
  TextArea,
  TextField,
  ThemeToggle,
  TypingIndicator,
} from '@techma/ui';
import { ArrowUp, BadgeCheck, Paperclip, Plus } from 'lucide-react';

const SWATCHES: [string, string][] = [
  ['canvas', '--ui-canvas'],
  ['surface', '--ui-surface'],
  ['sunken', '--ui-sunken'],
  ['border', '--ui-border'],
  ['border-strong', '--ui-border-strong'],
  ['field-border', '--ui-field-border'],
  ['text', '--ui-text'],
  ['text-muted', '--ui-text-muted'],
  ['text-subtle', '--ui-text-subtle'],
  ['action', '--ui-action'],
  ['action-hover', '--ui-action-hover'],
  ['on-action', '--ui-on-action'],
  ['trust', '--ui-trust'],
  ['trust-text', '--ui-trust-text'],
  ['trust-soft', '--ui-trust-soft'],
  ['trust-line', '--ui-trust-line'],
  ['on-trust', '--ui-on-trust'],
  ['sun', '--ui-sun'],
  ['danger-text', '--ui-danger-text'],
  ['danger-soft', '--ui-danger-soft'],
  ['warning-text', '--ui-warning-text'],
  ['warning-soft', '--ui-warning-soft'],
  ['focus', '--ui-focus'],
];

const TYPE_SCALE: [string, string, string][] = [
  ['Display 28/800', 'text-[28px] font-extrabold tracking-tight', 'Vos démarches, simplement'],
  ['Titre 22/800', 'text-[22px] font-extrabold', 'Bonjour !'],
  ['Lead 18', 'text-lg', 'Posez votre question sur une démarche.'],
  ['Corps 16', 'text-base', 'Je vous réponds en citant mes sources.'],
  ['Légende 13', 'text-[13px] text-ink-muted', 'Mise à jour le 22/10/2026'],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

function Panel({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div data-theme={theme} className="space-y-8 rounded-card border border-line bg-canvas p-5 text-ink">
      <h2 className="text-[22px] font-extrabold">Thème {theme === 'light' ? 'clair' : 'sombre'}</h2>

      <Section title="Couleurs">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SWATCHES.map(([name, variable]) => (
            <li key={name} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-8 shrink-0 rounded-sm border border-line-strong"
                style={{ background: `var(${variable})` }}
              />
              <span className="min-w-0 text-[13px]">
                <span className="block truncate font-semibold">{name}</span>
                <span className="block truncate text-ink-subtle">{variable}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typographie">
        <div className="space-y-2">
          {TYPE_SCALE.map(([label, classes, sample]) => (
            <div key={label}>
              <p className="text-[13px] text-ink-subtle">{label}</p>
              <p className={classes}>{sample}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primaire</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="ghost">Discret</Button>
          <Button size="sm">Petit</Button>
          <Button leadingIcon={<Plus aria-hidden="true" className="size-4" />}>Avec icône</Button>
          <Button disabled>Désactivé</Button>
        </div>
      </Section>

      <Section title="IconButton">
        <div className="flex flex-wrap items-center gap-2">
          <IconButton label="Envoyer" variant="primary">
            <ArrowUp aria-hidden="true" className="size-5" />
          </IconButton>
          <IconButton label="Joindre une pièce" variant="secondary">
            <Paperclip aria-hidden="true" className="size-5" />
          </IconButton>
          <IconButton label="Joindre une pièce" variant="ghost">
            <Paperclip aria-hidden="true" className="size-5" />
          </IconButton>
          <IconButton label="Envoyer" variant="primary" disabled>
            <ArrowUp aria-hidden="true" className="size-5" />
          </IconButton>
          <ThemeToggle />
        </div>
      </Section>

      <Section title="Chip">
        <ChipDemo />
      </Section>

      <Section title="TextField et TextArea">
        <div className="space-y-4">
          <TextField label="Nom affiché" hint="Tel qu’il apparaît sur votre dossier." required />
          <TextField label="Date de début" type="date" error="Indiquez une date valide." defaultValue="" />
          <TextArea label="Précisions" />
        </div>
      </Section>

      <Section title="Card">
        <div className="grid gap-2">
          <Card>Carte par défaut</Card>
          <Card tone="trust">Carte de confiance (terminée)</Card>
          <Card tone="warning">Carte d’attention (à valider)</Card>
          <Card tone="danger">Carte d’erreur (rejetée)</Card>
        </div>
      </Section>

      <Section title="Badge">
        <div className="flex flex-wrap gap-2">
          <Badge>Démo</Badge>
          <Badge tone="trust" icon={<BadgeCheck aria-hidden="true" className="size-4" />}>
            Source : service-public.bj
          </Badge>
          <Badge tone="warning">Analyse en cours</Badge>
          <Badge tone="danger">Rejetée</Badge>
        </div>
      </Section>

      <Section title="BrandMark">
        <div className="flex items-end gap-4">
          <BrandMark size="sm" />
          <BrandMark size="lg" />
        </div>
      </Section>

      <Section title="InlineAlert">
        <div className="space-y-2">
          <InlineAlert>Format non accepté.</InlineAlert>
          <InlineAlert tone="warning">Cette pièce est en cours d’analyse.</InlineAlert>
        </div>
      </Section>

      <Section title="TypingIndicator">
        <div className="inline-block rounded-card rounded-bl-md border border-line bg-surface px-4 py-2">
          <TypingIndicator />
        </div>
      </Section>
    </div>
  );
}

function ChipDemo() {
  const [selected, setSelected] = useState<string | null>('b');
  return (
    <div className="flex flex-wrap gap-2">
      {['a', 'b', 'c'].map((id) => (
        <Chip key={id} selected={selected === id} onClick={() => setSelected(id)}>
          Option {id.toUpperCase()}
        </Chip>
      ))}
      <Chip disabled>Désactivée</Chip>
    </div>
  );
}

export function DesignGuide() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[28px] font-extrabold tracking-tight">Guide de style (dev)</h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel theme="light" />
        <Panel theme="dark" />
      </div>
    </main>
  );
}
