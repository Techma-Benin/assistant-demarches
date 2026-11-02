// Procedures and administrations come from the official catalogue of service-public.bj (content/service-public/,
// refreshed by scripts/import-service-public.mjs). Only filing, payment, cases and officials are simulated.
import { readFileSync } from 'node:fs';

export type OfficialRole = 'agent' | 'admin' | 'super_admin';
export type CaseStatus = 'awaiting_payment' | 'received' | 'in_review' | 'completed' | 'rejected';
export type Actor = 'assistant' | 'applicant' | 'administration';
export type FieldValue = string | number | boolean | null;

export interface Administration {
  id: string;
  name: string;
  shortName: string;
  themes: string[];
  connection: { status: 'connected' | 'not_connected'; since: string | null };
}

export interface Procedure {
  id: string;
  title: string;
  administrationId: string;
  summary: string;
  requiredDocuments: string[];
  feeFcfa: number | null;
  processingDays: number | null;
  source: { procedureId: string; url: string; retrievedAt: string; version: string };
  validationStatus: 'draft' | 'validated';
  formSchema: Record<string, unknown>;
  assistedFiling: boolean;
  official: OfficialDetails;
}

export interface OfficialChannel {
  fee: string | null;
  delay: string | null;
  documents: string | null;
  process: string | null;
  where: string | null;
  url: string | null;
}

/** The portal's own text, copied as published. */
export interface OfficialDetails {
  serviceId: string;
  target: string | null;
  authority: string | null;
  inPerson: OfficialChannel | null;
  online: OfficialChannel | null;
  hours: string | null;
}

export interface Official {
  id: string;
  displayName: string;
  jobTitle: string;
  administrationId: string | null;
  role: OfficialRole;
  avatarUrl: string | null;
}

export interface CaseStep {
  id: string;
  label: string;
  state: 'done' | 'blocked' | 'pending';
  actor: Actor;
  note: string | null;
  at: string | null;
}

export interface CaseDocument {
  documentType: string;
  fileId: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sizeBytes: number;
}

export interface IssuedDocument {
  id: string;
  title: string;
  mimeType: 'application/pdf';
  issuedAt: string;
}

export interface Case {
  id: string;
  reference: string;
  simulated: true;
  procedureId: string;
  administrationId: string;
  requestId: string;
  applicantRef: string;
  status: CaseStatus;
  fields: Record<string, FieldValue>;
  documents: CaseDocument[];
  payment: { amountFcfa: number; status: 'not_required' | 'pending' | 'paid'; method: 'mobile_money' | null; reference: string | null; paidAt: string | null };
  steps: CaseStep[];
  issuedDocuments: IssuedDocument[];
  completedBy: 'assistant' | 'administration' | null;
  createdAt: string;
  updatedAt: string;
}

/** How the simulated administration instructs a case once it is received. */
export interface InstructionRule {
  /** Short code used in case references, e.g. SIM-JUS-2026-000001. */
  code: string;
  check: string;
  /** null: the assistant completes the case alone; otherwise the reason it needs an official. */
  blocker: string | null;
  issues: string | null;
}

interface ImportedChannel {
  status: string | null;
  fee: string | null;
  delay: string | null;
  documents: string | null;
  process: string | null;
  where?: string | null;
  url: string | null;
  /** Checked at import: only "ok" links are shown to users. */
  urlStatus: 'ok' | 'broken' | 'unreachable' | null;
}

interface ImportedService {
  id: string;
  title: string;
  url: string;
  status: string | null;
  published: boolean;
  thematicAreas: string[];
  description: string | null;
  target: string | null;
  ownedBy: { id: string; name: string | null } | null;
  competentAuthority: { id: string; name: string | null } | null;
  supervisingMinistry: { id: string; name: string | null } | null;
  inPerson: ImportedChannel | null;
  online: ImportedChannel | null;
  businessHours: string | null;
}

const imported = JSON.parse(readFileSync(new URL('../../../../content/service-public/catalogue.json', import.meta.url), 'utf8')) as {
  retrievedAt: string;
  services: ImportedService[];
};
const SEEDED_AT = imported.retrievedAt;
const SOURCE_VERSION = `service-public.bj ${SEEDED_AT.slice(0, 10)}`;
/** Services the portal currently publishes as active. */
const SERVICES = imported.services.filter((service) => service.status === 'Actif' && service.published);

/** Administrations we already use as department ids, and the ones connected to the simulated X-Road (filing possible). */
const KNOWN_ADMINISTRATIONS: Record<string, { id: string; shortName: string; connected: boolean }> = {
  'Ministère de la Justice et de la Législation': { id: 'justice', shortName: 'Justice', connected: true },
  'Ministère de l’Enseignement Supérieur et de la Recherche Scientifique': { id: 'enseignement', shortName: 'Enseignement supérieur', connected: true },
  'Agence Nationale d’Identification des Personnes': { id: 'anip', shortName: 'ANIP', connected: true },
  'Ministère des Affaires étrangères': { id: 'affaires-etrangeres', shortName: 'Affaires étrangères', connected: false },
  'Ministère de la Santé': { id: 'sante', shortName: 'Santé', connected: false },
  "Ministère de l'Intérieur et de la Sécurité Publique": { id: 'interieur', shortName: 'Intérieur', connected: false },
};

const slug = (value: string) =>
  value.toLocaleLowerCase('fr').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').slice(0, 63).replace(/^-+|-+$/g, '');
const shortNameOf = (name: string) => name.replace(/^Ministère\s+(de la |de l['’]|des |du |de )?/i, '').trim() || name;
const ministryOf = (service: ImportedService) =>
  service.supervisingMinistry?.name ?? service.competentAuthority?.name ?? service.ownedBy?.name ?? 'Administration non précisée';
const administrationIdOf = (name: string) => KNOWN_ADMINISTRATIONS[name]?.id ?? slug(name);

export const ADMINISTRATIONS: Administration[] = [...new Set(SERVICES.map(ministryOf))]
  .map((name) => {
    const known = KNOWN_ADMINISTRATIONS[name];
    const themes = [...new Set(SERVICES.filter((service) => ministryOf(service) === name).flatMap((service) => service.thematicAreas))].slice(0, 5);
    return {
      id: administrationIdOf(name),
      name,
      shortName: known?.shortName ?? shortNameOf(name),
      themes,
      connection: known?.connected ? { status: 'connected' as const, since: SEEDED_AT } : { status: 'not_connected' as const, since: null },
    };
  })
  .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'));

/** Connected administrations first, in the order above (officials' ids depend on it), then the others by name. */
function rank(administration: Administration): number {
  const index = Object.values(KNOWN_ADMINISTRATIONS).findIndex((known) => known.connected && known.id === administration.id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Inactive channels are left out: the portal does not offer them. A link that failed its check at import is not shown. */
const channel = (source: ImportedChannel | null): OfficialChannel | null =>
  source && source.status !== 'Inactif'
    ? {
        fee: source.fee,
        delay: source.delay,
        documents: source.documents,
        process: source.process,
        where: source.where ?? null,
        url: source.urlStatus === 'ok' ? source.url : null,
      }
    : null;

/** A single amount stated without condition; anything else (scales, "Variable", empty) stays in the official text. */
export function officialFee(value: string | null): number | null {
  const fee = value?.trim();
  if (!fee) return null;
  if (/^(gratuit|néant|0|0 ?f ?cfa)$/i.test(fee)) return 0;
  const amount = /^(\d{1,3}(?:[ .]\d{3})+|\d+)\s*(f ?cfa|francs? cfa)?$/i.exec(fee);
  return amount ? Number(amount[1].replace(/[ .]/g, '')) : null;
}

/** A single delay stated without condition, in whole days (24h counts as 1). */
export function officialDays(value: string | null): number | null {
  const delay = value?.trim().toLocaleLowerCase('fr');
  if (!delay) return null;
  if (/^instantan[ée]e?$/.test(delay)) return 0;
  const hours = /^(\d+)\s*(h|heures?)$/.exec(delay);
  if (hours) return Math.ceil(Number(hours[1]) / 24);
  const days = /^(\d+)\s*jours?$/.exec(delay);
  return days ? Number(days[1]) : null;
}

/** The same value on every offered channel, or null. */
function agreed(service: ImportedService, read: (source: ImportedChannel) => number | null): number | null {
  const values = [service.online, service.inPerson].filter((c): c is ImportedChannel => !!c && c.status !== 'Inactif').map(read);
  return values.length > 0 && values.every((value) => value !== null && value === values[0]) ? values[0] : null;
}

const form = (properties: Record<string, unknown>, requiredFields: string[], description: string) => ({
  type: 'object',
  additionalProperties: false,
  description,
  properties,
  required: requiredFields,
});
const field = (title: string) => ({ type: 'string', minLength: 1, maxLength: 200, title });
const NO_FORM = { type: 'object', additionalProperties: false, properties: {}, required: [] };

/** How the assistant files an official service through the simulated X-Road, for the case named in `scope`. */
export interface Filing {
  scope: string;
  requiredDocuments: string[];
  fields: Record<string, unknown>;
  requiredFields: string[];
  feeFcfa: number;
  processingDays: number | null;
  rule: InstructionRule;
}

/** Documents, fields, fee and delay restate the official sheet; test/catalogue.test.ts checks them against it. */
export const FILINGS: Record<string, Filing> = {
  PS00373: {
    scope: 'Béninois nés au Bénin, demande en ligne',
    requiredDocuments: ['extrait-acte-naissance'],
    fields: {
      adresseDomicile: field('Adresse du domicile'),
      profession: field('Profession'),
      nombreEnfantsACharge: { type: 'integer', minimum: 0, maximum: 30, title: "Nombre d'enfants à charge" },
      situationMatrimoniale: field('Situation matrimoniale'),
    },
    requiredFields: ['adresseDomicile', 'profession', 'nombreEnfantsACharge', 'situationMatrimoniale'],
    feeFcfa: 1900,
    processingDays: 3,
    rule: {
      code: 'JUS',
      check: 'Antécédents vérifiés auprès du Centre national du casier judiciaire',
      blocker: 'Nouvelle demande à vérifier : identité du demandeur à confirmer par un agent du Centre national du casier judiciaire',
      issues: 'Extrait B3 du casier judiciaire',
    },
  },
  PS00393: {
    scope: 'nationaux nés sur le territoire béninois',
    requiredDocuments: ['recepisse-ravip', 'ancien-acte-naissance'],
    fields: {},
    requiredFields: [],
    feeFcfa: 1000,
    processingDays: 2,
    rule: { code: 'ANIP', check: 'Récépissé RAVIP retrouvé au registre des personnes', blocker: null, issues: 'Acte de naissance sécurisé' },
  },
  PS00392: {
    scope: 'nationaux (CIP)',
    requiredDocuments: ['recepisse-ravip', 'acte-naissance', 'justificatif-residence'],
    fields: {},
    requiredFields: [],
    feeFcfa: 1800,
    processingDays: 2,
    rule: { code: 'ANIP', check: 'Identité retrouvée au registre des personnes', blocker: null, issues: "Certificat d'identification personnelle" },
  },
  PS00254: {
    scope: 'demande en ligne',
    requiredDocuments: ['diplome-a-authentifier', 'diplome-entree-formation'],
    fields: {},
    requiredFields: [],
    feeFcfa: 3000,
    processingDays: null,
    rule: { code: 'ENS', check: 'Diplôme vérifié auprès de la structure qui l’a délivré', blocker: null, issues: "Attestation d'authenticité de diplôme" },
  },
};

function procedure(service: ImportedService): Procedure {
  const filing = FILINGS[service.id];
  return {
    id: service.id,
    title: service.title,
    administrationId: administrationIdOf(ministryOf(service)),
    summary: service.description ?? service.title,
    requiredDocuments: filing?.requiredDocuments ?? [],
    feeFcfa: filing ? filing.feeFcfa : agreed(service, (c) => officialFee(c.fee)),
    processingDays: filing ? filing.processingDays : agreed(service, (c) => officialDays(c.delay)),
    source: { procedureId: service.id, url: service.url, retrievedAt: SEEDED_AT, version: SOURCE_VERSION },
    validationStatus: 'validated',
    formSchema: filing ? form(filing.fields, filing.requiredFields, `Dépôt par l'assistant : ${filing.scope}. Autres cas : voir la fiche officielle.`) : NO_FORM,
    assistedFiling: !!filing,
    official: {
      serviceId: service.id,
      target: service.target,
      authority: service.ownedBy?.name ?? null,
      inPerson: channel(service.inPerson),
      online: channel(service.online),
      hours: service.businessHours,
    },
  };
}

/** Every service the portal publishes; `rule` is set only when the assistant can file it. */
export const CATALOGUE: { procedure: Procedure; rule: InstructionRule | null }[] = SERVICES.map((service) => ({
  procedure: procedure(service),
  rule: FILINGS[service.id]?.rule ?? null,
}));

const officialId = (n: number) => `off_01JC${String(n).padStart(22, '0')}`;

export const OFFICIALS: Official[] = [
  { id: officialId(1), displayName: 'Super administrateur (simulation)', jobTitle: 'Présidence', administrationId: null, role: 'super_admin', avatarUrl: null },
  ...ADMINISTRATIONS.filter((administration) => administration.connection.status === 'connected').flatMap((administration, index) => [
    {
      id: officialId(10 + index * 2),
      displayName: `Responsable ${administration.shortName} (simulation)`,
      jobTitle: 'Administrateur',
      administrationId: administration.id,
      role: 'admin' as const,
      avatarUrl: null,
    },
    {
      id: officialId(11 + index * 2),
      displayName: `Agent ${administration.shortName} (simulation)`,
      jobTitle: 'Agent instructeur',
      administrationId: administration.id,
      role: 'agent' as const,
      avatarUrl: null,
    },
  ]),
];
