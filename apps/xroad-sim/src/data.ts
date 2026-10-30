// Fictitious data. Every name says "simulation" and no amount or delay is an official one.

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
  feeFcfa: number;
  processingDays: number;
  source: { procedureId: string; url: string; retrievedAt: string; version: string };
  validationStatus: 'draft' | 'validated';
  formSchema: Record<string, unknown>;
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

const SEEDED_AT = '2026-10-29T08:00:00.000Z';
const SIMULATION_URL = 'https://example.org/xroad-simulation';

export const ADMINISTRATIONS: Administration[] = [
  {
    id: 'justice',
    name: 'Ministère de la Justice — simulation',
    shortName: 'Justice',
    themes: ['casier judiciaire', 'nationalité'],
    connection: { status: 'connected', since: SEEDED_AT },
  },
  {
    id: 'affaires-etrangeres',
    name: 'Ministère des Affaires étrangères — simulation',
    shortName: 'Affaires étrangères',
    themes: ['légalisation', 'documents de voyage'],
    connection: { status: 'connected', since: SEEDED_AT },
  },
  {
    id: 'enseignement',
    name: "Ministère de l'Enseignement — simulation",
    shortName: 'Enseignement',
    themes: ['diplômes', 'examens'],
    connection: { status: 'connected', since: SEEDED_AT },
  },
  {
    id: 'sante',
    name: 'Ministère de la Santé — simulation',
    shortName: 'Santé',
    themes: ['vaccination', 'certificats médicaux'],
    connection: { status: 'connected', since: SEEDED_AT },
  },
  {
    id: 'interieur',
    name: "Ministère de l'Intérieur — simulation",
    shortName: 'Intérieur',
    themes: ['résidence', 'associations'],
    connection: { status: 'not_connected', since: null },
  },
];

const form = (properties: Record<string, unknown>, requiredFields: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: requiredFields,
});
const reason = (options: string[]) => ({ type: 'string', enum: options });
const copies = { type: 'integer', minimum: 1, maximum: 5 };

function procedure(
  id: string,
  title: string,
  administrationId: string,
  summary: string,
  requiredDocuments: string[],
  feeFcfa: number,
  processingDays: number,
  formSchema: Record<string, unknown>,
): Procedure {
  return {
    id,
    title,
    administrationId,
    summary: `${summary} Valeurs fictives de simulation.`,
    requiredDocuments,
    feeFcfa,
    processingDays,
    source: { procedureId: id, url: `${SIMULATION_URL}/${id}`, retrievedAt: SEEDED_AT, version: 'sim-1' },
    validationStatus: 'validated',
    formSchema,
  };
}

export const CATALOGUE: { procedure: Procedure; rule: InstructionRule }[] = [
  {
    procedure: procedure(
      'casier-judiciaire',
      'Extrait de casier judiciaire',
      'justice',
      "Délivrance d'un extrait de casier judiciaire, vérifié auprès du greffe par X-Road.",
      ['piece-identite'],
      1000,
      1,
      form({ motif: reason(['emploi', 'concours', 'voyage', 'autre']), exemplaires: copies }, ['motif']),
    ),
    rule: {
      code: 'JUS',
      check: 'Antécédents vérifiés auprès du greffe',
      blocker: "Nouvelle demande à vérifier : identité du demandeur à confirmer par un agent du greffe",
      issues: 'Extrait de casier judiciaire',
    },
  },
  {
    procedure: procedure(
      'certificat-nationalite',
      'Certificat de nationalité',
      'justice',
      'Délivrance du certificat de nationalité après contrôle de la filiation.',
      ['acte-naissance', 'piece-identite'],
      1500,
      10,
      form({ motif: reason(['passeport', 'concours', 'autre']) }, ['motif']),
    ),
    rule: {
      code: 'JUS',
      check: "Filiation vérifiée auprès de l'état civil",
      blocker: "Acte de naissance du parent introuvable dans l'état civil : vérification manuelle requise",
      issues: 'Certificat de nationalité',
    },
  },
  {
    procedure: procedure(
      'legalisation-document',
      "Légalisation d'un document",
      'affaires-etrangeres',
      "Légalisation d'un document public destiné à l'étranger.",
      ['document-a-legaliser'],
      2000,
      3,
      form({ paysDestination: { type: 'string', minLength: 2, maxLength: 60 }, exemplaires: copies }, ['paysDestination']),
    ),
    rule: {
      code: 'MAE',
      check: 'Signature du document contrôlée',
      blocker: "Signataire absent du registre des signatures : contrôle par un agent requis",
      issues: 'Document légalisé',
    },
  },
  {
    procedure: procedure(
      'authentification-diplome',
      "Attestation d'authenticité de diplôme",
      'enseignement',
      "Attestation confirmant qu'un diplôme a bien été délivré.",
      ['diplome'],
      0,
      2,
      form({ session: { type: 'integer', minimum: 1960, maximum: 2026 }, examen: reason(['CEP', 'BEPC', 'BAC']) }, ['session', 'examen']),
    ),
    rule: { code: 'ENS', check: 'Diplôme retrouvé dans le registre des examens', blocker: null, issues: "Attestation d'authenticité" },
  },
  {
    procedure: procedure(
      'releve-notes',
      'Relevé de notes du baccalauréat',
      'enseignement',
      "Délivrance d'un relevé de notes retrouvé dans le registre des examens.",
      ['piece-identite'],
      1000,
      2,
      form({ session: { type: 'integer', minimum: 1960, maximum: 2026 }, exemplaires: copies }, ['session']),
    ),
    rule: { code: 'ENS', check: 'Notes retrouvées dans le registre des examens', blocker: null, issues: 'Relevé de notes' },
  },
  {
    procedure: procedure(
      'duplicata-carnet-vaccination',
      'Duplicata de carnet de vaccination',
      'sante',
      "Duplicata d'un carnet de vaccination perdu ou abîmé.",
      ['piece-identite'],
      500,
      5,
      form({ motif: reason(['perte', 'deterioration']) }, ['motif']),
    ),
    rule: {
      code: 'SAN',
      check: 'Vaccinations retrouvées dans le registre de santé',
      blocker: 'Vaccinations antérieures à la numérisation : confirmation par le centre de santé requise',
      issues: 'Duplicata de carnet de vaccination',
    },
  },
];

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
