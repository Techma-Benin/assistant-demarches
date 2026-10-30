'use client';

import { useState, type ReactNode } from 'react';
import {
  Badge,
  BrandMark,
  Button,
  Card,
  Chip,
  Counter,
  CounterGrid,
  FlagGlyph,
  IconButton,
  InlineAlert,
  PromptBox,
  RebusGlyph,
  SegmentedControl,
  SourceList,
  SourcePill,
  CitationMark,
  StatusPill,
  StepTracker,
  Switch,
  TextArea,
  TextField,
  ThemeToggle,
  Tile,
  Toast,
  TypingIndicator,
  type SourceInfo,
} from '@techma/ui';
import { ArrowUp, BadgeCheck, Building2, IdCard, Paperclip, Plus, Scale } from 'lucide-react';

const SWATCHES: [string, string][] = [
  ['canvas', '--ui-canvas'],
  ['surface', '--ui-surface'],
  ['sunken', '--ui-sunken'],
  ['shell', '--ui-shell'],
  ['border', '--ui-border'],
  ['border-subtle', '--ui-border-subtle'],
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
  ['flag-red', '--ui-flag-red'],
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

const SUGGESTIONS = [
  'Comment obtenir un casier judiciaire ?',
  'Renouveler mon passeport',
  'Déclarer une naissance',
  'Créer mon entreprise',
];

const CYCLE_ITEMS = [
  { icon: <Building2 className="size-[0.62em]" strokeWidth={2.4} />, label: 'Entreprise', className: 'bg-flag-red text-white' },
  { icon: <Scale className="size-[0.62em]" strokeWidth={2.4} />, label: 'Justice', className: 'border border-line bg-surface text-ink' },
  { icon: <IdCard className="size-[0.62em]" strokeWidth={2.4} />, label: 'Identité', className: 'bg-action text-on-action' },
];

const SOURCES: SourceInfo[] = [
  {
    index: 1,
    title: 'Casier judiciaire - bulletin n°3',
    domain: 'service-public.bj',
    href: 'https://service-public.bj',
    version: 'version 2',
    retrievedAtLabel: 'Consultée le 22/10/2026',
  },
  { index: 2, title: 'Passeport ordinaire', domain: 'service-public.bj' },
];

const COUNTERS: { value: string; label: string; tone?: 'trust' | 'danger' }[] = [
  { value: '1', label: 'seule porte d’entrée pour toutes les démarches' },
  { value: '24/7', label: 'sur le web et sur WhatsApp', tone: 'trust' },
  { value: '0', label: 'mot de passe ou code SMS demandé', tone: 'danger' },
  { value: '100 %', label: 'des informations administratives citent leur fiche' },
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

      <Section title="Polices">
        <div className="space-y-1">
          <p className="font-display text-[28px] font-extrabold tracking-tight">Inter Tight - font-display</p>
          <p className="font-sans text-[18px]">Inter - font-sans (texte courant)</p>
          <p className="font-mono text-[14px]">ui-monospace - font-mono (Réf. req_01J…X4)</p>
        </div>
        <h2 className="font-display font-extrabold text-[clamp(56px,9vw,128px)] leading-[0.95] tracking-[-0.055em]">
          Bonjour, <FlagGlyph decorative /> Bénin.
        </h2>
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
        <div className="space-y-3">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-2">
              <Button size={size}>Primaire</Button>
              <Button size={size} variant="secondary">Secondaire</Button>
              <Button size={size} variant="outline">Contour</Button>
              <Button size={size} variant="trust">Confiance</Button>
              <Button size={size} variant="ghost">Discret</Button>
              <Button size={size} disabled>Désactivé</Button>
            </div>
          ))}
          <Button leadingIcon={<Plus aria-hidden="true" className="size-4" />}>Avec icône</Button>
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
        <div className="flex flex-wrap items-end gap-4">
          <BrandMark size="sm" />
          <BrandMark size="lg" />
          <BrandMark size="lg" showFlag={false} />
        </div>
      </Section>

      <Section title="Tile">
        <div className="grid gap-2 sm:grid-cols-2">
          <Tile tone="default" className="md:p-7">Tuile par défaut</Tile>
          <Tile tone="ink" className="md:p-7">Demandez comme au guichet.</Tile>
          <Tile tone="sun" className="md:p-7">Aucun NPI. Aucun code SMS.</Tile>
          <Tile tone="trust" className="md:p-7">Aussi sur WhatsApp.</Tile>
          <Tile tone="outline" className="md:p-7">Chaque réponse cite sa source.</Tile>
          <Tile tone="white" className="md:p-7">L’assistant prépare. Vous validez.</Tile>
        </div>
      </Section>

      <Section title="StatusPill">
        <div className="flex flex-wrap gap-2">
          <StatusPill status="validated">Validée</StatusPill>
          <StatusPill status="draft">Brouillon</StatusPill>
          <StatusPill status="toValidate">À valider par vous</StatusPill>
          <StatusPill status="submitted">Transmise</StatusPill>
          <StatusPill status="info">Info</StatusPill>
          <StatusPill status="danger">Erreur</StatusPill>
        </div>
      </Section>

      <Section title="Switch">
        <SwitchDemo />
      </Section>

      <Section title="RebusGlyph">
        <p className="font-display text-[clamp(24px,3vw,36px)] font-semibold leading-tight tracking-[-0.025em]">
          Quelle que soit votre démarche, commencez ici{' '}
          <RebusGlyph variant="arrow-flag" flag={<FlagGlyph decorative width="1.3em" height="0.9em" />} />
        </p>
        <p className="font-display text-[clamp(24px,3vw,36px)] font-semibold leading-tight tracking-[-0.025em]">
          Une entreprise <RebusGlyph variant="cycle" items={CYCLE_ITEMS} /> - une seule porte d’entrée.
        </p>
      </Section>

      <Section title="PromptBox">
        <div className="space-y-4">
          <PromptBox
            label="Votre question"
            placeholder="Posez votre question, par exemple : comment obtenir un casier judiciaire ?"
            onSubmit={() => {}}
            onAttach={() => {}}
            onMicrophone={() => {}}
          />
          <PromptBox variant="compact" label="Poser une autre question" placeholder="Poser une autre question…" onSubmit={() => {}} />
        </div>
      </Section>

      <Section title="Sources">
        <p className="text-[19px] leading-relaxed">
          Le bulletin n°3 se demande en ligne
          <CitationMark index={1} />. Le passeport suit une autre procédure
          <CitationMark index={2} />.
        </p>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((source) => (
            <SourcePill key={source.index} {...source} />
          ))}
        </div>
        <SourceList sources={SOURCES} />
      </Section>

      <Section title="Counter">
        <CounterGrid className="lg:grid-cols-2">
          {COUNTERS.map((c) => (
            <Counter key={c.value} value={c.value} label={c.label} tone={c.tone} />
          ))}
        </CounterGrid>
      </Section>

      <Section title="SegmentedControl">
        <SegmentedDemo />
      </Section>

      <Section title="StepTracker">
        <StepTracker
          steps={[
            { label: 'Question comprise', status: 'done', description: 'Casier judiciaire' },
            { label: 'Vos informations', status: 'current', description: 'À compléter' },
            { label: 'Pièce d’identité', status: 'todo', description: 'À ajouter' },
            { label: 'Validation sur le portail', status: 'todo', description: 'Par vous, sur le portail officiel' },
          ]}
        />
      </Section>

      <Section title="Toast">
        <ToastDemo />
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

function SwitchDemo() {
  const [trust, setTrust] = useState(true);
  const [ink, setInk] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Switch tone="trust" checked={trust} onCheckedChange={setTrust}>Confiance</Switch>
      <Switch tone="trust" checked={false}>Confiance (arrêt)</Switch>
      <Switch tone="ink" checked={ink} onCheckedChange={setInk}>Encre</Switch>
      <Switch tone="ink" checked>Encre (marche)</Switch>
    </div>
  );
}

function SegmentedDemo() {
  const [value, setValue] = useState('all');
  return (
    <SegmentedControl
      aria-label="Filtrer par statut"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'all', label: 'Toutes' },
        { value: 'validated', label: 'Validées' },
        { value: 'draft', label: 'Brouillons' },
      ]}
    />
  );
}

function ToastDemo() {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button variant="secondary" onClick={() => setMessage('Modification enregistrée')}>
        Afficher le toast
      </Button>
      <div className="min-h-12">
        <Toast message={message} onDismiss={() => setMessage(null)} />
      </div>
    </div>
  );
}

function ChipDemo() {
  const [selected, setSelected] = useState<string | null>(SUGGESTIONS[0]);
  return (
    <div className="flex flex-wrap gap-2">
      {SUGGESTIONS.map((text) => (
        <Chip key={text} selected={selected === text} onClick={() => setSelected(text)}>
          {text}
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
