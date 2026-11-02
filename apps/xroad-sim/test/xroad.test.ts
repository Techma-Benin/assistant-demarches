import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { importPKCS8 } from 'jose';
import { ConfigError, loadConfig } from '../src/config.js';
import {
  ANIP_AGENT,
  APPLICANT,
  BACKEND,
  ENSEIGNEMENT_AGENT,
  JUSTICE_ADMIN,
  JUSTICE_AGENT,
  OTHER_APPLICANT,
  SUPER_ADMIN,
  TOOLING,
  assertConforms,
  call,
  key,
  requestId,
  restartSim,
  serviceToken,
  startSim,
  traceparent,
  upload,
} from './helpers.js';

const CASIER_FIELDS = { adresseDomicile: 'Cotonou, Cadjèhoun', profession: 'Comptable', nombreEnfantsACharge: 2, situationMatrimoniale: 'Marié' };

async function caseInput(url: string, procedureId: string, fields: Record<string, unknown>, documentTypes: string[], applicant = APPLICANT) {
  const documents = [];
  for (const documentType of documentTypes) documents.push(await upload(url, documentType, applicant));
  return { requestId: requestId(), procedureId, channel: 'web', fields, documents };
}
const casier = (url: string, fields: Record<string, unknown> = CASIER_FIELDS) => caseInput(url, 'PS00373', fields, ['extrait-acte-naissance']);
const acteNaissance = (url: string) => caseInput(url, 'PS00393', {}, ['recepisse-ravip', 'ancien-acte-naissance']);

async function file(url: string, body: unknown) {
  const created = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body });
  assertConforms('xroadCreateCase', created, 201);
  return created.body;
}
async function pay(url: string, id: string) {
  const paid = await call(url, 'POST', `/v1/cases/${id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  assertConforms('xroadPayCase', paid, 200);
  return paid.body;
}
/** A casier judiciaire filed and paid: it now waits for an official. */
async function caseInReview(url: string) {
  const created = await file(url, await casier(url));
  return pay(url, created.id);
}
const act = (url: string, id: string, official: string, action: string, note: string | null = null) =>
  call(url, 'POST', `/v1/cases/${id}/actions`, { token: BACKEND, official, body: { action, note } });
const pendingCount = async (url: string, official: string) =>
  (await call(url, 'GET', '/v1/cases?view=pending', { token: BACKEND, official })).body.items.length;

test('catalogue : administrations officielles, recherche, filtres et fiche inconnue', async (t) => {
  const { url } = await startSim(t);
  const administrations = await call(url, 'GET', '/v1/administrations', { token: TOOLING });
  assertConforms('xroadListAdministrations', administrations, 200);
  assert.deepEqual(
    administrations.body.items.filter((item: any) => item.connection.status === 'connected').map((item: any) => item.id),
    ['justice', 'enseignement', 'anip'],
  );
  const interieur = administrations.body.items.find((item: any) => item.id === 'interieur');
  assert.equal(interieur.connection.status, 'not_connected');

  const search = await call(url, 'GET', '/v1/procedures?query=casier%20judiciaire', { token: TOOLING });
  assertConforms('xroadSearchProcedures', search, 200);
  assert.equal(search.body.items[0].id, 'PS00373');
  const accents = await call(url, 'GET', `/v1/procedures?query=${encodeURIComponent('acte de naissance securise')}`, { token: BACKEND });
  assert.ok(accents.body.items.some((item: any) => item.id === 'PS00393'), 'recherche insensible aux accents');
  const justice = await call(url, 'GET', '/v1/procedures?administrationId=justice', { token: TOOLING });
  assert.ok(justice.body.items.length > 1);
  assert.ok(justice.body.items.every((item: any) => item.administrationId === 'justice'));
  const assisted = await call(url, 'GET', '/v1/procedures?assisted=true', { token: BACKEND });
  assert.deepEqual(assisted.body.items.map((item: any) => item.id).sort(), ['PS00254', 'PS00373', 'PS00392', 'PS00393']);
  assert.equal((await call(url, 'GET', '/v1/procedures?limit=2', { token: TOOLING })).body.items.length, 2);

  const procedure = await call(url, 'GET', '/v1/procedures/PS00373', { token: TOOLING });
  assertConforms('xroadGetProcedure', procedure, 200);
  assert.deepEqual(procedure.body.filing.requiredDocuments.map((document: any) => document.documentType), ['extrait-acte-naissance']);
  assert.equal(procedure.body.filing.feeFcfa, 1900);
  assert.equal(procedure.body.source.url, 'https://service-public.bj/public/services/service/PS00373');
  assert.equal(procedure.body.online.fee, '1 900 FCFA');
  assert.equal((await call(url, 'GET', '/v1/procedures/PS00328', { token: TOOLING })).body.filing, null, 'passeport : information seulement');
  assertConforms('xroadGetProcedure', await call(url, 'GET', '/v1/procedures/inconnue', { token: TOOLING }), 404);
});

test('fiche d’information seulement : dépôt refusé en NOT_ASSISTED, avec le lien officiel', async (t) => {
  const { url } = await startSim(t);
  const refused = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: await caseInput(url, 'PS00024', {}, []) });
  assertConforms('xroadCreateCase', refused, 409);
  assert.equal(refused.body.code, 'NOT_ASSISTED');
  assert.match(refused.body.detail, /https:\/\/service-public\.bj\/public\/services\/service\/PS00024/);
});

test('sécurité : jeton, client, scope, audience, émetteur et en-têtes de contexte', async (t) => {
  const { url } = await startSim(t);
  const noToken = await call(url, 'GET', '/v1/administrations');
  assertConforms('xroadListAdministrations', noToken, 401);
  assert.equal(noToken.headers.get('www-authenticate'), 'Bearer');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: 'mock-tooling-xroad' })).status, 401, 'plus aucun jeton statique');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: await serviceToken('tooling', 'xroad:apply', { audience: 'techma-tooling' }) })).status, 401, 'audience');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: await serviceToken('tooling', 'xroad:apply', { issuer: 'http://autre/realms/techma' }) })).status, 401, 'émetteur');
  const otherKey = await importPKCS8(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'RS256');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: await serviceToken('tooling', 'xroad:apply', { key: otherKey }) })).status, 401, 'signature');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: await serviceToken('interface', 'xroad:apply') })).status, 403, 'client non accepté');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: await serviceToken('tooling', 'events:publish') })).status, 403, 'scope absent');

  // The Tooling has no access to the officials' view.
  assertConforms('xroadListCases', await call(url, 'GET', '/v1/cases', { token: TOOLING, official: JUSTICE_AGENT }), 403);
  assert.equal((await call(url, 'POST', '/v1/cases', { token: TOOLING, body: await acteNaissance(url) })).status, 400, 'X-Applicant-Ref requis');
  assert.equal((await call(url, 'GET', '/v1/cases', { token: BACKEND, official: 'sub-inconnu' })).status, 403, 'personne inconnue');
  assert.equal((await call(url, 'GET', '/v1/cases', { token: BACKEND })).status, 400, 'aucune identité');
  assert.equal((await call(url, 'GET', '/v1/cases', { token: BACKEND, applicant: APPLICANT, official: JUSTICE_AGENT })).status, 400, 'deux identités');
});

test('traceparent facultatif : créé s’il manque, propagé s’il est fourni', async (t) => {
  const { url } = await startSim(t);
  const created = await call(url, 'GET', '/v1/administrations', { token: TOOLING });
  assert.match(created.headers.get('traceparent') ?? '', /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  const sent = traceparent();
  const failed = await call(url, 'GET', '/v1/administrations', { traceparent: sent });
  assert.equal(failed.headers.get('traceparent'), sent);
  assert.equal(failed.body.traceId, sent.split('-')[1]);
});

test('pièces : envoi, types refusés, taille, pièce d’un autre usager ou déjà utilisée', async (t) => {
  const { url } = await startSim(t);
  const uploaded = await call(url, 'POST', '/v1/uploads', { token: TOOLING, applicant: APPLICANT, body: Buffer.from('%PDF-1.4'), headers: { 'x-file-mime-type': 'application/pdf' } });
  assertConforms('xroadUpload', uploaded, 201);
  assert.equal(uploaded.body.sizeBytes, 8);
  assert.ok(Date.parse(uploaded.body.expiresAt) > Date.now() + 50 * 60 * 1000, 'conservée 1 h');

  const audio = await call(url, 'POST', '/v1/uploads', { token: TOOLING, applicant: APPLICANT, body: Buffer.from('x'), headers: { 'x-file-mime-type': 'audio/ogg' } });
  assert.equal(audio.status, 415);
  assert.equal(audio.body.code, 'UNSUPPORTED_MEDIA_TYPE');
  const empty = await call(url, 'POST', '/v1/uploads', { token: TOOLING, applicant: APPLICANT, body: Buffer.alloc(0), headers: { 'x-file-mime-type': 'application/pdf' } });
  assert.equal(empty.status, 400);
  const tooLarge = await call(url, 'POST', '/v1/uploads', { token: TOOLING, applicant: APPLICANT, body: Buffer.alloc(10 * 1024 * 1024 + 1), headers: { 'x-file-mime-type': 'application/pdf' } });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.code, 'FILE_TOO_LARGE');

  // Taken from someone else: this upload does not exist for this applicant.
  const foreign = await upload(url, 'extrait-acte-naissance', OTHER_APPLICANT);
  const stolen = await call(url, 'POST', '/v1/cases', {
    token: TOOLING,
    applicant: APPLICANT,
    body: { requestId: requestId(), procedureId: 'PS00373', channel: 'web', fields: CASIER_FIELDS, documents: [foreign] },
  });
  assertConforms('xroadCreateCase', stolen, 404);

  const piece = await upload(url, 'extrait-acte-naissance');
  await file(url, { requestId: requestId(), procedureId: 'PS00373', channel: 'web', fields: CASIER_FIELDS, documents: [piece] });
  const reused = await call(url, 'POST', '/v1/cases', {
    token: TOOLING,
    applicant: APPLICANT,
    body: { requestId: requestId(), procedureId: 'PS00373', channel: 'web', fields: CASIER_FIELDS, documents: [piece] },
  });
  assert.equal(reused.status, 404, 'une pièce ne sert qu’une fois');
});

test('dossier complété seul par l’assistant : paiement simulé, document délivré dans Complété', async (t) => {
  const { url } = await startSim(t);
  const created = await file(url, await acteNaissance(url));
  assert.equal(created.status, 'awaiting_payment');
  assert.equal(created.administrationId, 'anip');
  assert.equal(created.title, 'Délivrance d\'acte de naissance sécurisé');
  assert.equal(created.channel, 'web');
  assert.equal(created.simulated, true);
  assert.match(created.reference, /^SIM-ANIP-\d{4}-\d{6}$/);
  assert.deepEqual(created.payment, { amountFcfa: 1000, status: 'pending', reference: null, paidAt: null, simulated: true });
  assert.equal(await pendingCount(url, ANIP_AGENT), 0, 'pas encore payé : pas en attente');

  const paid = await pay(url, created.id);
  assert.equal(paid.status, 'completed');
  assert.equal(paid.completedBy, 'assistant');
  assert.equal(paid.payment.status, 'paid');
  assert.match(paid.payment.reference, /^SIM-PAY-/);
  assert.ok(paid.steps.every((step: any) => step.state === 'done'), 'aucune étape en attente');
  const issued = paid.documents.filter((document: any) => document.kind === 'issued');
  assert.equal(issued.length, 1);
  assert.match(issued[0].name, /simulation/i);
  assert.equal(await pendingCount(url, ANIP_AGENT), 0);
  const completed = await call(url, 'GET', '/v1/cases?view=completed', { token: BACKEND, official: ANIP_AGENT });
  assert.deepEqual(completed.body.items.map((item: any) => item.id), [created.id]);

  const again = await call(url, 'POST', `/v1/cases/${created.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  assertConforms('xroadPayCase', again, 409);
  assert.equal(again.body.code, 'INVALID_TRANSITION');

  const documentPath = `/v1/cases/${created.id}/documents/${issued[0].id}`;
  const pdf = await call(url, 'GET', documentPath, { token: TOOLING, applicant: APPLICANT });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type') ?? '', /^application\/pdf/);
  assert.equal(pdf.raw.length, issued[0].sizeBytes);
  const latin1 = pdf.raw.toString('latin1');
  assert.equal(latin1.slice(0, 5), '%PDF-');
  assert.match(latin1, /SIMULATION - SANS VALEUR ADMINISTRATIVE/);
  assert.match(latin1, new RegExp(created.reference));
  assert.match(latin1, /Référence du dossier/, 'accents conservés en WinAnsi');
  const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(latin1)?.[1]);
  assert.equal(latin1.slice(xref, xref + 4), 'xref', 'startxref pointe sur la table');

  // Another applicant, or an official of another administration, learns nothing.
  assertConforms('xroadGetCase', await call(url, 'GET', `/v1/cases/${created.id}`, { token: TOOLING, applicant: OTHER_APPLICANT }), 404);
  assert.equal((await call(url, 'GET', documentPath, { token: TOOLING, applicant: OTHER_APPLICANT })).status, 404);
  assert.equal((await call(url, 'GET', `/v1/cases/${created.id}`, { token: BACKEND, official: JUSTICE_AGENT })).status, 404);

  // The submitted piece can be read back by the applicant and by the administration.
  const submitted = paid.documents.find((document: any) => document.kind === 'submitted');
  assert.match((await call(url, 'GET', `/v1/cases/${created.id}/documents/${submitted.id}`, { token: BACKEND, official: ANIP_AGENT })).raw.toString(), /piece recepisse-ravip/);
});

test('parcours de démonstration : Justice voit le dossier, complément, réponse, approbation', async (t) => {
  const { url } = await startSim(t);
  assert.equal(await pendingCount(url, JUSTICE_AGENT), 0, 'aucun dossier inventé au démarrage');

  const created = await caseInReview(url);
  assert.equal(created.status, 'in_review');
  assert.equal(created.administrationId, 'justice');
  assert.equal(created.completedBy, null, 'jamais complété seul');
  assert.equal(created.steps.find((step: any) => step.id === 'check').state, 'blocked');

  // Slide « un message, deux bureaux » : En attente (1) pour la Justice, (0) pour l'Enseignement, le super admin voit tout.
  assert.equal(await pendingCount(url, JUSTICE_AGENT), 1);
  assert.equal(await pendingCount(url, ENSEIGNEMENT_AGENT), 0);
  assert.equal(await pendingCount(url, SUPER_ADMIN), 1);
  assert.equal((await call(url, 'GET', `/v1/cases/${created.id}`, { token: BACKEND, official: ENSEIGNEMENT_AGENT })).status, 404);
  assert.equal((await act(url, created.id, ENSEIGNEMENT_AGENT, 'claim')).status, 404, 'cloisonnement sur les actions');
  const foreignFilter = await call(url, 'GET', '/v1/cases?administrationId=justice', { token: BACKEND, official: ENSEIGNEMENT_AGENT });
  assertConforms('xroadListCases', foreignFilter, 403);

  const claimed = await act(url, created.id, JUSTICE_AGENT, 'claim');
  assertConforms('xroadActOnCase', claimed, 200);
  assert.equal(claimed.body.status, 'in_review');
  assert.equal(claimed.body.claimedBy, 'off_01JD0000000000000000000001');
  assert.equal((await act(url, created.id, JUSTICE_ADMIN, 'claim')).status, 409, 'déjà pris en charge');

  assert.equal((await act(url, created.id, JUSTICE_AGENT, 'request_information')).status, 400, 'motif obligatoire');
  assert.equal((await act(url, created.id, JUSTICE_AGENT, 'request_information', '   ')).status, 400);
  const requested = await act(url, created.id, JUSTICE_AGENT, 'request_information', "Copie de l'acte illisible");
  assertConforms('xroadActOnCase', requested, 200);
  assert.equal(requested.body.status, 'information_requested');
  assert.equal(requested.body.informationRequest.note, "Copie de l'acte illisible");
  assert.equal(await pendingCount(url, JUSTICE_AGENT), 1, 'toujours en attente');
  assert.equal((await act(url, created.id, JUSTICE_AGENT, 'approve')).status, 409, 'pas de décision tant que le complément manque');

  const seenByApplicant = await call(url, 'GET', `/v1/cases/${created.id}`, { token: TOOLING, applicant: APPLICANT });
  assert.equal(seenByApplicant.body.informationRequest.note, "Copie de l'acte illisible");

  const response = (body: unknown, applicant = APPLICANT) => call(url, 'POST', `/v1/cases/${created.id}/responses`, { token: TOOLING, applicant, body });
  const noFields = { message: 'Voici une copie lisible', fields: {}, documents: [] };
  assertConforms('xroadRespondToCase', await response(noFields, OTHER_APPLICANT), 404);
  assert.equal((await response({ ...noFields, fields: { nombreEnfantsACharge: -1 } })).status, 400, 'champs conformes au formulaire');
  const replied = await response({ message: 'Voici une copie lisible', fields: { profession: 'Enseignante' }, documents: [await upload(url, 'extrait-acte-naissance')] });
  assertConforms('xroadRespondToCase', replied, 200);
  assert.equal(replied.body.status, 'in_review');
  assert.equal(replied.body.informationRequest, null);
  assert.equal(replied.body.fields.profession, 'Enseignante');
  assert.equal(replied.body.documents.filter((document: any) => document.kind === 'submitted').length, 2);
  assert.ok(replied.body.steps.some((step: any) => step.actor === 'applicant' && step.note === 'Voici une copie lisible'));
  assertConforms('xroadRespondToCase', await response(noFields), 409);

  const approved = await act(url, created.id, JUSTICE_AGENT, 'approve', 'Identité confirmée');
  assertConforms('xroadActOnCase', approved, 200);
  assert.equal(approved.body.status, 'completed');
  assert.equal(approved.body.completedBy, 'administration');
  assert.equal(approved.body.decisionNote, 'Identité confirmée');
  assert.ok(approved.body.steps.every((step: any) => step.state === 'done'), JSON.stringify(approved.body.steps));
  const issued = approved.body.documents.find((document: any) => document.kind === 'issued');
  assert.match(issued.name, /Extrait B3/);
  assert.equal((await call(url, 'GET', `/v1/cases/${created.id}/documents/${issued.id}`, { token: TOOLING, applicant: APPLICANT })).status, 200);
  assert.equal(await pendingCount(url, JUSTICE_AGENT), 0);
  assert.equal((await act(url, created.id, JUSTICE_AGENT, 'reject', 'trop tard')).status, 409);

  const journal = await call(url, 'GET', `/v1/activity?caseId=${created.id}`, { token: BACKEND, official: JUSTICE_ADMIN });
  assertConforms('xroadListActivity', journal, 200);
  assert.deepEqual(journal.body.items.map((entry: any) => entry.action).reverse(), [
    'case.created',
    'case.paid',
    'step.completed',
    'case.claimed',
    'information.requested',
    'information.provided',
    'case.approved',
    'document.issued',
  ]);
  assert.doesNotMatch(JSON.stringify(journal.body), /Voici une copie lisible/, 'pas de texte de l’usager dans le journal');
  assert.deepEqual((await call(url, 'GET', `/v1/activity?caseId=${created.id}`, { token: BACKEND, official: ENSEIGNEMENT_AGENT })).body.items, [], 'cloisonnement du journal');
});

test('rejet : motif obligatoire, depuis in_review ou information_requested, sans document délivré', async (t) => {
  const { url } = await startSim(t);
  const first = await caseInReview(url);
  assert.equal((await act(url, first.id, JUSTICE_AGENT, 'reject')).status, 400);
  const rejected = await act(url, first.id, JUSTICE_AGENT, 'reject', 'Pièce non conforme');
  assertConforms('xroadActOnCase', rejected, 200);
  assert.equal(rejected.body.status, 'rejected');
  assert.equal(rejected.body.decisionNote, 'Pièce non conforme');
  assert.equal(rejected.body.completedBy, null);
  assert.ok(!rejected.body.documents.some((document: any) => document.kind === 'issued'));
  assert.ok(rejected.body.steps.every((step: any) => step.state === 'done'));
  assert.deepEqual((await call(url, 'GET', '/v1/cases?view=rejected', { token: BACKEND, official: JUSTICE_AGENT })).body.items.map((item: any) => item.id), [first.id]);

  const second = await caseInReview(url);
  await act(url, second.id, JUSTICE_AGENT, 'request_information', 'Précisez');
  const fromRequested = await act(url, second.id, JUSTICE_ADMIN, 'reject', 'Sans réponse');
  assert.equal(fromRequested.body.status, 'rejected');
  assert.equal(fromRequested.body.informationRequest, null);
});

test('dépôt refusé : formulaire, pièces, doublon, corps invalide et type de contenu', async (t) => {
  const { url } = await startSim(t);
  const post = (body: unknown, contentType?: string) => call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body, contentType });
  const incomplete = await post(await casier(url, { adresseDomicile: 'Cotonou' }));
  assertConforms('xroadCreateCase', incomplete, 409);
  assert.equal(incomplete.body.code, 'REQUEST_INCOMPLETE');
  const noPiece = await post(await caseInput(url, 'PS00373', CASIER_FIELDS, []));
  assert.equal(noPiece.body.code, 'REQUEST_INCOMPLETE');
  assert.match(noPiece.body.detail, /Extrait d'acte de naissance/, 'libellé de la pièce');
  assert.equal((await post(await caseInput(url, 'PS99999', {}, []))).status, 404);

  const body = await casier(url);
  await file(url, body);
  const duplicate = await post({ ...body, documents: [await upload(url, 'extrait-acte-naissance')] });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'CONFLICT');

  assert.equal((await post({ procedureId: 'PS00373' })).status, 400, 'corps invalide');
  assert.equal((await post(await casier(url), 'text/plain')).status, 415);
  const badJson = await fetch(`${url}/v1/cases`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOOLING}`, 'x-applicant-ref': APPLICANT, 'content-type': 'application/json', 'idempotency-key': key() },
    body: '{',
  });
  assert.equal(badJson.status, 400);
});

test('idempotence : même clé et même corps rejoue la première réponse, autre corps refusé', async (t) => {
  const { url } = await startSim(t);
  const body = await casier(url);
  const idempotencyKey = key();
  const first = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body, idempotencyKey });
  assertConforms('xroadCreateCase', first, 201);
  await pay(url, first.body.id);
  const replay = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body, idempotencyKey });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, first.body, 'la réponse du premier appel, pas l’état actuel');
  const other = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: { ...body, requestId: requestId() }, idempotencyKey });
  assert.equal(other.status, 409);
  assert.equal(other.body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body, idempotencyKey: 'court' })).status, 400);

  const actionKey = key();
  const claim = () => call(url, 'POST', `/v1/cases/${first.body.id}/actions`, { token: BACKEND, official: JUSTICE_AGENT, idempotencyKey: actionKey, body: { action: 'claim', note: null } });
  assert.equal((await claim()).status, 200);
  assert.equal((await claim()).status, 200, 'un clic rejoué ne devient pas une erreur');
});

test('mes démarches : l’usager voit ses dossiers, le Backend les lit aussi avec X-Applicant-Ref', async (t) => {
  const { url } = await startSim(t);
  const mine = await file(url, await acteNaissance(url));
  const others = await caseInput(url, 'PS00393', {}, ['recepisse-ravip', 'ancien-acte-naissance'], OTHER_APPLICANT);
  await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: OTHER_APPLICANT, body: others });
  const list = await call(url, 'GET', '/v1/cases', { token: BACKEND, applicant: APPLICANT });
  assertConforms('xroadListCases', list, 200);
  assert.deepEqual(list.body.items.map((item: any) => item.id), [mine.id]);
});

test('pagination : curseur opaque jusqu’à la fin de la liste', async (t) => {
  const { url } = await startSim(t);
  for (let n = 0; n < 3; n += 1) await caseInReview(url);
  const first = await call(url, 'GET', '/v1/cases?view=pending&limit=2', { token: BACKEND, official: JUSTICE_AGENT });
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.nextCursor);
  const second = await call(url, 'GET', `/v1/cases?view=pending&limit=2&cursor=${first.body.nextCursor}`, { token: BACKEND, official: JUSTICE_AGENT });
  assert.equal(second.body.items.length, 1);
  assert.equal(second.body.nextCursor, null);
  assert.equal((await call(url, 'GET', '/v1/cases?limit=101', { token: BACKEND, official: JUSTICE_AGENT })).status, 400);
});

test('annuaire : profil par le sub Keycloak, permissions selon le rôle', async (t) => {
  const { url } = await startSim(t);
  const me = (official: string) => call(url, 'GET', '/v1/officials/me', { token: BACKEND, official });
  const agent = await me(JUSTICE_AGENT);
  assertConforms('xroadGetMe', agent, 200);
  assert.equal(agent.body.official.displayName, 'Rodrigue Agossou');
  assert.equal(agent.body.administration.id, 'justice');
  assert.deepEqual(agent.body.permissions, ['cases:read', 'cases:act']);
  const admin = await me(JUSTICE_ADMIN);
  assert.ok(admin.body.permissions.includes('officials:manage'));
  const superAdmin = await me(SUPER_ADMIN);
  assert.equal(superAdmin.body.administration, null);
  assert.ok(superAdmin.body.permissions.includes('administrations:all'));
  assertConforms('xroadGetMe', await me('sub-inconnu'), 404);

  const updated = await call(url, 'PUT', '/v1/officials/me', { token: BACKEND, official: JUSTICE_AGENT, body: { displayName: 'R. Agossou', jobTitle: 'Greffier' } });
  assertConforms('xroadUpdateMe', updated, 200);
  assert.equal(updated.body.jobTitle, 'Greffier');
  const avatar = await call(url, 'PUT', '/v1/officials/me/avatar', { token: BACKEND, official: JUSTICE_AGENT, body: { avatarUrl: 'http://127.0.0.1:4010/v1/admin/avatars/1' } });
  assertConforms('xroadSetAvatar', avatar, 200);
  assert.equal((await me(JUSTICE_AGENT)).body.official.avatarUrl, 'http://127.0.0.1:4010/v1/admin/avatars/1');
});

test('agents : listes par rôle, création par le super admin, droits de l’admin bornés', async (t) => {
  const { url } = await startSim(t);
  const list = async (official: string, query = '') => (await call(url, 'GET', `/v1/officials${query}`, { token: BACKEND, official })).body.items.map((item: any) => item.subject);
  assert.deepEqual(await list(JUSTICE_AGENT), [JUSTICE_AGENT], 'un agent ne voit que lui');
  assert.deepEqual((await list(JUSTICE_ADMIN)).sort(), [JUSTICE_AGENT, JUSTICE_ADMIN].sort());
  assert.equal((await list(SUPER_ADMIN)).length, 5);
  assert.deepEqual(await list(SUPER_ADMIN, '?administrationId=anip'), [ANIP_AGENT]);
  assertConforms('xroadListOfficials', await call(url, 'GET', '/v1/officials?administrationId=anip', { token: BACKEND, official: JUSTICE_ADMIN }), 403);

  const registration = { subject: 'nouveau-sub', email: 'nouveau@demo.techma.bj', displayName: 'Nouvel Agent', jobTitle: 'Agent', administrationId: 'justice', role: 'agent' };
  assertConforms('xroadCreateOfficial', await call(url, 'POST', '/v1/officials', { token: BACKEND, official: JUSTICE_ADMIN, body: registration }), 403);
  const created = await call(url, 'POST', '/v1/officials', { token: BACKEND, official: SUPER_ADMIN, body: registration });
  assertConforms('xroadCreateOfficial', created, 201);
  assert.equal(created.body.active, true);
  assert.equal((await call(url, 'POST', '/v1/officials', { token: BACKEND, official: SUPER_ADMIN, body: registration })).status, 409, 'déjà inscrite');
  assert.equal((await call(url, 'POST', '/v1/officials', { token: BACKEND, official: SUPER_ADMIN, body: { ...registration, subject: 'a', email: 'a@demo.techma.bj', administrationId: null } })).status, 400, 'agent sans administration');
  assert.equal((await call(url, 'POST', '/v1/officials', { token: BACKEND, official: SUPER_ADMIN, body: { ...registration, subject: 'b', email: 'b@demo.techma.bj', administrationId: 'inconnue' } })).status, 400);

  const update = (official: string, id: string, body: unknown) => call(url, 'PUT', `/v1/officials/${id}`, { token: BACKEND, official, body });
  const id = created.body.id;
  assert.equal((await update(JUSTICE_AGENT, id, { administrationId: 'justice', role: 'agent', active: false })).status, 403);
  assert.equal((await update(JUSTICE_ADMIN, id, { administrationId: 'anip', role: 'agent', active: true })).status, 403, 'pas hors de son administration');
  assert.equal((await update(JUSTICE_ADMIN, id, { administrationId: null, role: 'super_admin', active: true })).status, 403, 'pas d’élargissement');
  const superAdminId = (await call(url, 'GET', '/v1/officials/me', { token: BACKEND, official: SUPER_ADMIN })).body.official.id;
  assert.equal((await update(JUSTICE_ADMIN, superAdminId, { administrationId: 'justice', role: 'agent', active: true })).status, 404, 'hors de portée');
  const deactivated = await update(JUSTICE_ADMIN, id, { administrationId: 'justice', role: 'agent', active: false });
  assertConforms('xroadUpdateOfficial', deactivated, 200);
  assert.equal(deactivated.body.active, false);
  assert.equal((await call(url, 'GET', '/v1/cases', { token: BACKEND, official: 'nouveau-sub' })).status, 403, 'compte désactivé');
  assert.equal((await call(url, 'GET', '/v1/officials/me', { token: BACKEND, official: 'nouveau-sub' })).status, 403);

  const moved = await update(SUPER_ADMIN, id, { administrationId: 'anip', role: 'admin', active: true });
  assert.equal(moved.body.administrationId, 'anip');
  const last = await update(SUPER_ADMIN, superAdminId, { administrationId: 'justice', role: 'agent', active: true });
  assertConforms('xroadUpdateOfficial', last, 409);
  assert.match(last.body.detail, /dernier super administrateur/);
});

test('indicateurs : chiffres réels, période, canaux et périmètre par administration', async (t) => {
  const start = Date.parse('2026-11-02T08:00:00Z');
  let now = start;
  const { url } = await startSim(t, () => now);
  const metrics = (official: string, query = '') => call(url, 'GET', `/v1/metrics${query}`, { token: BACKEND, official });
  const empty = await metrics(SUPER_ADMIN);
  assertConforms('xroadGetMetrics', empty, 200);
  assert.equal(empty.body.received, 0, 'aucun chiffre inventé');
  assert.equal(empty.body.medianProcessingHours, null);

  await file(url, await acteNaissance(url)); // Awaiting payment: not counted.
  const first = await caseInReview(url);
  const whatsapp = await casier(url);
  const second = await file(url, { ...whatsapp, channel: 'whatsapp' });
  await pay(url, second.id);
  now += 4 * 3600 * 1000;
  await act(url, first.id, JUSTICE_AGENT, 'approve');
  await act(url, second.id, JUSTICE_AGENT, 'request_information', 'Précisez');
  const auto = await file(url, await acteNaissance(url));
  await pay(url, auto.id);

  const justice = (await metrics(JUSTICE_AGENT)).body;
  assert.equal(justice.administrationId, 'justice');
  assert.equal(justice.received, 2);
  assert.equal(justice.pending, 1);
  assert.equal(justice.informationRequested, 1);
  assert.equal(justice.completed, 1);
  assert.equal(justice.completedByAssistant, 0);
  assert.equal(justice.rejected, 0);
  assert.equal(justice.medianProcessingHours, 4);
  assert.deepEqual(justice.byChannel, [{ channel: 'web', count: 1 }, { channel: 'whatsapp', count: 1 }]);
  assert.deepEqual(justice.topProcedures.map((top: any) => [top.procedureId, top.count]), [['PS00373', 2]]);
  assert.equal(justice.pending, await pendingCount(url, JUSTICE_AGENT), 'même chiffre que la liste En attente');

  const all = (await metrics(SUPER_ADMIN)).body;
  assert.equal(all.administrationId, null);
  assert.equal(all.received, 3);
  assert.equal(all.completedByAssistant, 1);
  assert.equal((await metrics(SUPER_ADMIN, '?administrationId=anip')).body.received, 1);
  assertConforms('xroadGetMetrics', await metrics(JUSTICE_AGENT, '?administrationId=anip'), 403);

  const before = encodeURIComponent('2026-11-01T00:00:00Z');
  const outOfPeriod = await metrics(JUSTICE_AGENT, `?from=2026-10-01T00:00:00Z&to=${before}`);
  assert.equal(outOfPeriod.body.received, 0);
  assert.equal(outOfPeriod.body.period.to, '2026-11-01T00:00:00.000Z');
  assert.equal((await metrics(JUSTICE_AGENT, '?from=demain')).status, 400);
  assert.equal((await metrics(JUSTICE_AGENT, `?from=${encodeURIComponent('2026-12-01T00:00:00Z')}&to=${before}`)).status, 400);
});

test('redémarrage : dossiers, références, pièces, réponses idempotentes et annuaire conservés en base', async (t) => {
  const { url } = await startSim(t);
  const body = await acteNaissance(url);
  const idempotencyKey = key();
  const filed = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body, idempotencyKey });
  const inReview = await caseInReview(url);
  await call(url, 'PUT', '/v1/officials/me', { token: BACKEND, official: JUSTICE_AGENT, body: { displayName: 'R. Agossou', jobTitle: 'Greffier' } });

  const restarted = (await restartSim(t)).url;
  assert.equal((await call(restarted, 'GET', `/v1/cases/${inReview.id}`, { token: BACKEND, official: JUSTICE_AGENT })).body.reference, inReview.reference);
  assert.equal(await pendingCount(restarted, JUSTICE_AGENT), 1);
  const piece = inReview.documents.find((document: any) => document.kind === 'submitted');
  assert.match((await call(restarted, 'GET', `/v1/cases/${inReview.id}/documents/${piece.id}`, { token: TOOLING, applicant: APPLICANT })).raw.toString(), /piece extrait-acte-naissance/);
  const replay = await call(restarted, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body, idempotencyKey });
  assert.deepEqual(replay.body, filed.body, 'la clé survit au redémarrage');
  assert.equal((await call(restarted, 'GET', '/v1/officials/me', { token: BACKEND, official: JUSTICE_AGENT })).body.official.jobTitle, 'Greffier', 'le démarrage n’écrase pas une modification');

  const next = await caseInReview(restarted);
  assert.equal(Number(next.reference.slice(-6)), Number(inReview.reference.slice(-6)) + 1, 'la numérotation continue');
  const concurrent = await Promise.all([caseInReview(restarted), caseInReview(restarted)]);
  assert.notEqual(concurrent[0].reference, concurrent[1].reference, 'références uniques sous concurrence');
});

test('vue des connexions : administrations et derniers échanges, sans donnée personnelle', async (t) => {
  const { url } = await startSim(t);
  await caseInReview(url);
  const page = await fetch(`${url}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Ministère de la Justice et de la Législation/);
  assert.match(html, /xroadCreateCase/);
  assert.doesNotMatch(html, new RegExp(APPLICANT), 'pas de référence d’usager');
  const health = await call(url, 'GET', '/health');
  assert.deepEqual(health.body, { status: 'ok', simulated: true });
});

test('configuration : variables obligatoires et émetteur en HTTPS hors poste local', () => {
  const base = { OIDC_ISSUER: 'http://127.0.0.1:8080/realms/techma', DATABASE_URL: 'postgres://x', CATALOGUE_FILE: 'c.json' };
  assert.equal(loadConfig(base).jwksUrl.href, 'http://127.0.0.1:8080/realms/techma/protocol/openid-connect/certs');
  assert.equal(loadConfig(base).port, 4040);
  assert.throws(() => loadConfig({ ...base, OIDC_ISSUER: 'http://keycloak.example/realms/techma' }), ConfigError);
  for (const name of Object.keys(base)) {
    assert.throws(() => loadConfig({ ...base, [name]: '' }), ConfigError, name);
  }
  assert.throws(() => loadConfig({ ...base, XROAD_PORT: 'abc' }), ConfigError);
});
