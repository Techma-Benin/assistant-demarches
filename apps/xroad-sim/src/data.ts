// Procedures and administrations come from the official catalogue of service-public.bj (content/service-public/,
// refreshed by scripts/import-service-public.mjs). Only filing, payment, cases and officials are simulated.
import { readFileSync } from 'node:fs';
import type { Schemas } from '@techma/contracts-ts';

export type Administration = Schemas['Administration'];
export type Procedure = Schemas['Procedure'];
export type Official = Schemas['Official'];
export type OfficialRole = Schemas['OfficialRole'];
export type Case = Schemas['Case'];
export type CaseStatus = Schemas['CaseStatus'];
export type CaseStep = Schemas['CaseStep'];
export type CaseDocument = Schemas['CaseDocument'];
export type ActivityEntry = Schemas['ActivityEntry'];
export type FieldValue = string | number | boolean | null;

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
/** Ministries whose name stays too long for a menu once "Ministère de" is removed (the contract allows 50 characters). */
const LONG_NAMES: Record<string, string> = {
  'Ministère des Enseignements Secondaires, Technique et de la Formation Professionnelle': 'Enseignements secondaires et technique',
  "Ministère des Petites et Moyennes Entreprises et de la Promotion de l'Emploi": 'Petites et moyennes entreprises, emploi',
  'Ministère du Cadre de Vie et des Transports, en charge du Développement Durable': 'Cadre de vie et transports',
  "Ministère du Développement et de la Coordination de l'action gouvernementale (MDC)": 'Développement et coordination gouvernementale',
};
const shortNameOf = (name: string) =>
  LONG_NAMES[name] ?? (name.replace(/^Ministère\s+(de la |de l['’]|des |du |de )?/i, '').trim() || name).slice(0, 50).trimEnd();
const ministryOf = (service: ImportedService) =>
  service.supervisingMinistry?.name ?? service.competentAuthority?.name ?? service.ownedBy?.name ?? 'Administration non précisée';
const administrationIdOf = (name: string) => KNOWN_ADMINISTRATIONS[name]?.id ?? slug(name);

/** Connected administrations first, in the order above, then the others by name. */
function rank(administration: Administration): number {
  const index = Object.values(KNOWN_ADMINISTRATIONS).findIndex((known) => known.connected && known.id === administration.id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Inactive channels are left out: the portal does not offer them. A link that failed its check at import is not shown. */
const channel = (source: ImportedChannel | null): Procedure['online'] =>
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

/** How the assistant files an official service through the simulated X-Road, for the case named in `scope`. */
export interface Filing {
  scope: string;
  requiredDocuments: { documentType: string; label: string }[];
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
    requiredDocuments: [{ documentType: 'extrait-acte-naissance', label: "Extrait d'acte de naissance sécurisé ou légalisé" }],
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
    requiredDocuments: [
      { documentType: 'recepisse-ravip', label: 'Copie du récépissé RAVIP' },
      { documentType: 'ancien-acte-naissance', label: "Copie de l'ancien acte de naissance" },
    ],
    fields: {},
    requiredFields: [],
    feeFcfa: 1000,
    processingDays: 2,
    rule: { code: 'ANIP', check: 'Récépissé RAVIP retrouvé au registre des personnes', blocker: null, issues: 'Acte de naissance sécurisé' },
  },
  PS00392: {
    scope: 'nationaux (CIP)',
    requiredDocuments: [
      { documentType: 'recepisse-ravip', label: 'Copie du récépissé RAVIP' },
      { documentType: 'acte-naissance', label: "Copie de l'acte de naissance" },
      { documentType: 'justificatif-residence', label: 'Attestation de résidence ou facture SBEE/SONEB' },
    ],
    fields: {},
    requiredFields: [],
    feeFcfa: 1800,
    processingDays: 2,
    rule: { code: 'ANIP', check: 'Identité retrouvée au registre des personnes', blocker: null, issues: "Certificat d'identification personnelle" },
  },
  PS00254: {
    scope: 'demande en ligne',
    requiredDocuments: [
      { documentType: 'diplome-a-authentifier', label: 'Copie du diplôme à authentifier' },
      { documentType: 'diplome-entree-formation', label: "Copie du diplôme d'entrée dans la formation" },
    ],
    fields: {},
    requiredFields: [],
    feeFcfa: 3000,
    processingDays: null,
    rule: { code: 'ENS', check: 'Diplôme vérifié auprès de la structure qui l’a délivré', blocker: null, issues: "Attestation d'authenticité de diplôme" },
  },
};

const MIME_TYPES: Schemas['RequiredDocument']['acceptedMimeTypes'] = ['application/pdf', 'image/jpeg', 'image/png'];

function procedure(service: ImportedService, retrievedAt: string): Procedure {
  const filing = FILINGS[service.id];
  return {
    id: service.id,
    title: service.title,
    administrationId: administrationIdOf(ministryOf(service)),
    summary: service.description ?? service.title,
    target: service.target,
    authority: service.ownedBy?.name ?? null,
    feeFcfa: filing ? filing.feeFcfa : agreed(service, (c) => officialFee(c.fee)),
    processingDays: filing ? filing.processingDays : agreed(service, (c) => officialDays(c.delay)),
    inPerson: channel(service.inPerson),
    online: channel(service.online),
    hours: service.businessHours,
    source: { procedureId: service.id, url: service.url, retrievedAt },
    filing: filing
      ? {
          scope: filing.scope,
          // A free-form JSON Schema: the generated type cannot describe it.
          formSchema: form(filing.fields, filing.requiredFields, `Dépôt par l'assistant : ${filing.scope}. Autres cas : voir la fiche officielle.`) as unknown as Record<string, never>,
          requiredDocuments: filing.requiredDocuments.map((document) => ({ ...document, acceptedMimeTypes: MIME_TYPES })),
          feeFcfa: filing.feeFcfa,
          processingDays: filing.processingDays,
        }
      : null,
  };
}

export interface CatalogueEntry {
  procedure: Procedure;
  /** Set only when the assistant can file this procedure. */
  rule: InstructionRule | null;
}

export interface Catalogue {
  administrations: Administration[];
  entries: CatalogueEntry[];
}

/** Every service the portal currently publishes as active, and the administrations behind them. */
export function loadCatalogue(file: string): Catalogue {
  const imported = JSON.parse(readFileSync(file, 'utf8')) as { retrievedAt: string; services: ImportedService[] };
  const services = imported.services.filter((service) => service.status === 'Actif' && service.published);
  const administrations = [...new Set(services.map(ministryOf))]
    .map((name): Administration => {
      const known = KNOWN_ADMINISTRATIONS[name];
      const themes = [...new Set(services.filter((service) => ministryOf(service) === name).flatMap((service) => service.thematicAreas))].slice(0, 5);
      return {
        id: administrationIdOf(name),
        name,
        shortName: known?.shortName ?? shortNameOf(name),
        themes,
        connection: known?.connected ? { status: 'connected', since: imported.retrievedAt } : { status: 'not_connected', since: null },
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'));
  return {
    administrations,
    entries: services.map((service) => ({ procedure: procedure(service, imported.retrievedAt), rule: FILINGS[service.id]?.rule ?? null })),
  };
}

function demoOfficial(n: number, username: string, subject: string, displayName: string, jobTitle: string, administrationId: string | null, role: OfficialRole): Official {
  return {
    id: `off_01JD${String(n).padStart(22, '0')}`,
    subject: `7f3c2a10-${subject}-4000-8000-00000000${subject}`,
    email: `${username}@demo.techma.bj`,
    displayName,
    jobTitle,
    administrationId,
    role,
    avatarUrl: null,
    active: true,
  };
}

/** Demo directory: subject, email and name of infra/keycloak/realm-techma.json (test/catalogue.test.ts checks them). */
export const DEMO_OFFICIALS: Official[] = [
  demoOfficial(1, 'agent.justice', '0002', 'Rodrigue Agossou', 'Agent instructeur', 'justice', 'agent'),
  demoOfficial(2, 'admin.justice', '0003', 'Mireille Dossou', 'Responsable du service', 'justice', 'admin'),
  demoOfficial(3, 'agent.enseignement', '0004', 'Koffi Adjovi', 'Agent instructeur', 'enseignement', 'agent'),
  demoOfficial(4, 'agent.anip', '0005', 'Fatou Zinsou', 'Agent instructeur', 'anip', 'agent'),
  demoOfficial(5, 'super.admin', '0006', 'Super Administrateur', 'Super administrateur', null, 'super_admin'),
];
