'use client';

import { Badge } from '@techma/ui';
import Link from 'next/link';
import {
  c3,
  type AdminConversation,
  type AuditEntry,
  type ModelConfig,
  type Procedure,
} from '@/lib/c3-client';
import { formatDateTime, formatFcfa, shorten } from '@/lib/format';
import { PaginatedTable, type Column } from './paginated-table';

const LIMIT = 20;
const mono = 'font-mono text-[13px]';

const loadProcedures = (cursor: string | null) => c3.listProcedures({ cursor, limit: LIMIT });
const loadModels = (cursor: string | null) => c3.listModels({ cursor, limit: LIMIT });
const loadConversations = (cursor: string | null) => c3.listConversations({ cursor, limit: LIMIT });
const loadAudit = (cursor: string | null) => c3.listAudit({ cursor, limit: LIMIT });

const yesNo = (value: boolean) => <Badge>{value ? 'Oui' : 'Non'}</Badge>;

const editLink = (href: string, label: string) => (
  <Link href={href} aria-label={label} className="font-semibold underline">
    Modifier
  </Link>
);

const procedureColumns: Column<Procedure>[] = [
  { header: 'Titre', cell: (p) => <span className="font-semibold">{p.title}</span> },
  { header: 'Administration', cell: (p) => p.administrationId },
  {
    header: 'Statut',
    cell: (p) =>
      p.validationStatus === 'validated' ? <Badge tone="trust">Validée</Badge> : <Badge tone="warning">Brouillon</Badge>,
  },
  { header: 'Frais', cell: (p) => formatFcfa(p.feeFcfa) },
  { header: 'Délai (jours)', cell: (p) => p.processingDays },
  {
    header: 'Actions',
    cell: (p) => editLink(`/procedures/${encodeURIComponent(p.id)}`, `Modifier ${p.title}`),
  },
];

const modelColumns: Column<ModelConfig>[] = [
  { header: 'Identifiant', cell: (m) => <span className={mono}>{m.id}</span> },
  { header: 'Fournisseur', cell: (m) => m.provider },
  { header: 'Modèle', cell: (m) => m.model },
  { header: 'Version des instructions', cell: (m) => m.promptVersion },
  { header: 'Température', cell: (m) => m.temperature },
  { header: 'Actif', cell: (m) => yesNo(m.active) },
  { header: 'Actions', cell: (m) => editLink(`/models/${encodeURIComponent(m.id)}`, `Modifier ${m.id}`) },
];

const CHANNELS: Record<AdminConversation['channel'], string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  mobile: 'Mobile',
};

const conversationColumns: Column<AdminConversation>[] = [
  { header: 'Identifiant', cell: (c) => <span className={mono}>{c.id}</span> },
  { header: 'Canal', cell: (c) => <Badge>{CHANNELS[c.channel]}</Badge> },
  { header: 'Langue', cell: (c) => c.locale },
  { header: 'Créée le', cell: (c) => formatDateTime(c.createdAt) },
  {
    header: 'Usager',
    cell: (c) => (
      <span className={mono} title={c.userRef}>
        {shorten(c.userRef, 12)}
      </span>
    ),
  },
];

const auditColumns: Column<AuditEntry>[] = [
  { header: 'Date', cell: (a) => formatDateTime(a.at) },
  { header: 'Acteur', cell: (a) => a.actorRef },
  { header: 'Action', cell: (a) => a.action },
  { header: 'Ressource', cell: (a) => <span className={mono}>{a.resourceId}</span> },
  {
    header: 'Trace',
    cell: (a) => (
      <span className={mono} title={a.traceId}>
        {a.traceId.slice(0, 8)}
      </span>
    ),
  },
];

export function ProceduresTable() {
  return (
    <PaginatedTable
      label="Fiches de démarche"
      noun="les fiches de démarche"
      columns={procedureColumns}
      rowKey={(p) => p.id}
      load={loadProcedures}
    />
  );
}

export function ModelsTable() {
  return (
    <PaginatedTable label="Modèles" noun="les modèles" columns={modelColumns} rowKey={(m) => m.id} load={loadModels} />
  );
}

export function ConversationsTable() {
  return (
    <PaginatedTable
      label="Conversations"
      noun="les conversations"
      columns={conversationColumns}
      rowKey={(c) => c.id}
      load={loadConversations}
    />
  );
}

export function AuditTable() {
  return (
    <PaginatedTable
      label="Journal d’audit"
      noun="le journal d’audit"
      columns={auditColumns}
      rowKey={(a) => a.id}
      load={loadAudit}
    />
  );
}
