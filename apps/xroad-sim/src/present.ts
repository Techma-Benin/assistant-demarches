import type { Administration, Case, Official, OfficialRole, Procedure } from './data.js';
import { newId } from './ids.js';

const MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export function presentProcedure(procedure: Procedure) {
  const filing = procedure.assistedFiling
    ? {
        scope: (procedure.formSchema as { description?: string }).description ?? procedure.title,
        formSchema: procedure.formSchema,
        requiredDocuments: procedure.requiredDocuments.map((documentType) => ({
          documentType,
          label: documentType.replace(/-/g, ' '),
          acceptedMimeTypes: [...MIME],
        })),
        feeFcfa: procedure.feeFcfa ?? 0,
        processingDays: procedure.processingDays,
      }
    : null;
  return {
    id: procedure.id,
    title: procedure.title,
    administrationId: procedure.administrationId,
    summary: procedure.summary,
    target: procedure.official.target,
    authority: procedure.official.authority,
    feeFcfa: procedure.feeFcfa,
    processingDays: procedure.processingDays,
    inPerson: procedure.official.inPerson,
    online: procedure.official.online,
    hours: procedure.official.hours,
    source: {
      procedureId: procedure.source.procedureId,
      url: procedure.source.url,
      retrievedAt: procedure.source.retrievedAt,
    },
    filing,
  };
}

export function presentOfficial(official: Official) {
  return {
    id: official.id,
    subject: official.subject,
    email: official.email,
    displayName: official.displayName,
    jobTitle: official.jobTitle,
    administrationId: official.administrationId,
    role: official.role,
    avatarUrl: official.avatarUrl,
    active: official.active,
  };
}

export function permissionsOf(role: OfficialRole): string[] {
  if (role === 'super_admin') return ['cases:read', 'cases:act', 'officials:read', 'officials:manage', 'administrations:all'];
  if (role === 'admin') return ['cases:read', 'cases:act', 'officials:read', 'officials:manage'];
  return ['cases:read', 'cases:act'];
}

export function presentMe(official: Official, administration: Administration | null) {
  return {
    official: presentOfficial(official),
    administration,
    permissions: permissionsOf(official.role),
  };
}

export function presentCase(record: Case) {
  const submitted = record.documents.map((document, index) => ({
    id: document.fileId.startsWith('doc_') ? document.fileId : documentIdFrom(record.id, index),
    kind: 'submitted' as const,
    documentType: document.documentType,
    name: document.documentType,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    createdAt: record.createdAt,
  }));
  const issued = record.issuedDocuments.map((document) => ({
    id: document.id,
    kind: 'issued' as const,
    documentType: 'delivre',
    name: document.title,
    mimeType: document.mimeType,
    sizeBytes: 1024,
    createdAt: document.issuedAt,
  }));
  return {
    id: record.id,
    reference: record.reference,
    simulated: true as const,
    procedureId: record.procedureId,
    title: record.title,
    administrationId: record.administrationId,
    applicantRef: record.applicantRef,
    requestId: record.requestId,
    channel: record.channel,
    status: record.status,
    fields: record.fields,
    documents: [...submitted, ...issued],
    payment: {
      amountFcfa: record.payment.amountFcfa,
      status: record.payment.status,
      reference: record.payment.reference,
      paidAt: record.payment.paidAt,
      simulated: true as const,
    },
    steps: record.steps,
    informationRequest: record.informationRequest,
    claimedBy: record.claimedBy,
    completedBy: record.completedBy,
    decisionNote: record.decisionNote,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function documentIdFrom(caseId: string, index: number): string {
  const suffix = caseId.slice(4);
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const last = alphabet[index % 32];
  return `doc_${suffix.slice(0, 25)}${last}`;
}

export function activityId(caseId: string, index: number): string {
  return `act_${caseId.slice(4, 29)}${String(index).padStart(1, '0')}`.slice(0, 30) || newId('act');
}
