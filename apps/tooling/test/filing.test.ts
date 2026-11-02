import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { act, ANIP_AGENT, assertSchema, grantMandate, JUSTICE_AGENT, ok, OTHER_USER, rows, startStack, toolError, type Stack } from './helpers.js';

const CASIER = 'PS00373';
const ACTE = 'PS00393';

const caseEvents = async (s: Stack) =>
  (await rows<{ event: any }>(s, "select event from outbox where event->>'type' = 'bj.techma.case.updated.v2' order by seq")).map(({ event }) => {
    assertSchema('Event', event);
    return event.data;
  });

async function readyCasier(s: Stack) {
  const mandateId = await grantMandate(s, CASIER);
  const created = ok(await act(s, 'request.create', { procedureId: CASIER }, { mandateId }));
  const requestId = created.id as string;
  ok(
    await act(
      s,
      'request.update',
      {
        requestId,
        fields: [
          { name: 'adresseDomicile', value: 'Cotonou, Akpakpa', source: 'answer' },
          { name: 'profession', value: 'Enseignante', source: 'answer' },
          { name: 'nombreEnfantsACharge', value: 2, source: 'answer' },
          { name: 'situationMatrimoniale', value: 'Mariée', source: 'answer' },
        ],
      },
      { mandateId },
    ),
  );
  const ready = ok(await act(s, 'documents.attach', { requestId, documentType: 'extrait-acte-naissance', fileId: s.backend.addFile() }, { mandateId }));
  return { mandateId, requestId, created, ready };
}

test('brouillon : champs avec libellé et provenance, pièces attendues, manques, puis prêt', async (t) => {
  const s = await startStack(t);
  const mandateId = await grantMandate(s, CASIER);
  const key = randomUUID();
  const created = ok(await act(s, 'request.create', { procedureId: CASIER }, { mandateId, key }));
  assertSchema('Request', created);
  assert.deepEqual(ok(await act(s, 'request.create', { procedureId: CASIER }, { mandateId, key })), created, 'rejeu idempotent');
  assert.equal(created.status, 'draft');
  assert.equal(created.administrationId, 'justice');
  assert.equal(created.caseId, null);
  assert.deepEqual(created.fields.map((field: any) => [field.name, field.label, field.value, field.source]), [
    ['adresseDomicile', 'Adresse du domicile', null, null],
    ['profession', 'Profession', null, null],
    ['nombreEnfantsACharge', "Nombre d'enfants à charge", null, null],
    ['situationMatrimoniale', 'Situation matrimoniale', null, null],
  ]);
  assert.deepEqual(created.documents, [{ documentType: 'extrait-acte-naissance', label: "Extrait d'acte de naissance sécurisé ou légalisé", fileId: null }]);
  assert.equal(created.missing.length, 5);

  const requestId = created.id;
  assert.equal(toolError(await act(s, 'request.update', { requestId, fields: [{ name: 'inconnu', value: 'x', source: 'answer' }] }, { mandateId })).code, 'INVALID_REQUEST');
  assert.equal(toolError(await act(s, 'request.update', { requestId, fields: [{ name: 'nombreEnfantsACharge', value: 'deux', source: 'answer' }] }, { mandateId })).code, 'INVALID_REQUEST');
  const partial = ok(await act(s, 'request.update', { requestId, fields: [{ name: 'profession', value: 'Enseignante', source: 'document' }] }, { mandateId }));
  assert.deepEqual(partial.fields[1], { name: 'profession', label: 'Profession', value: 'Enseignante', source: 'document' });
  assert.equal(partial.missing.length, 4);

  assert.equal(toolError(await act(s, 'documents.attach', { requestId, documentType: 'autre-piece', fileId: s.backend.addFile() }, { mandateId })).code, 'INVALID_REQUEST');
  assert.equal(toolError(await act(s, 'documents.attach', { requestId, documentType: 'extrait-acte-naissance', fileId: s.backend.addFile(undefined, 'audio/ogg') }, { mandateId })).code, 'UNSUPPORTED_MEDIA_TYPE');
  assert.equal(toolError(await act(s, 'documents.attach', { requestId, documentType: 'extrait-acte-naissance', fileId: s.backend.addFile(OTHER_USER) }, { mandateId })).code, 'NOT_FOUND', 'pièce d’un autre usager');
  assert.equal(toolError(await act(s, 'documents.attach', { requestId, documentType: 'extrait-acte-naissance', fileId: s.backend.addFile(undefined, undefined, -1000) }, { mandateId })).code, 'REQUEST_INCOMPLETE', 'pièce expirée');
  assert.equal(toolError(await act(s, 'request.submit', { requestId }, { mandateId, channel: 'web' })).code, 'REQUEST_INCOMPLETE');

  assert.equal(toolError(await act(s, 'case.status', { requestId }, { userRef: OTHER_USER })).code, 'NOT_FOUND', 'cloisonnement par usager');
});

test('démarche non déposable : NOT_ASSISTED, aucune demande créée', async (t) => {
  const s = await startStack(t);
  const search = ok(await act(s, 'procedures.search', { query: 'passeport' }));
  const informative = (search.items as any[]).find((item) => item.filing === null);
  assert.ok(informative, 'une fiche d’information seulement');
  const mandateId = await grantMandate(s, informative.id);
  assert.equal(toolError(await act(s, 'request.create', { procedureId: informative.id }, { mandateId })).code, 'NOT_ASSISTED');
  assert.equal((await rows(s, 'select id from requests')).length, 0);
});

test('casier judiciaire : dépôt, paiement, complément demandé et fourni, approbation, suivi publié au Backend', async (t) => {
  const s = await startStack(t);
  const { mandateId, requestId, ready } = await readyCasier(s);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.missing, []);

  assert.equal(toolError(await act(s, 'request.submit', { requestId }, { mandateId })).code, 'INVALID_REQUEST', 'X-Channel obligatoire');
  const key = randomUUID();
  const submitted = ok(await act(s, 'request.submit', { requestId }, { mandateId, channel: 'web', key }));
  assertSchema('Request', submitted.request);
  assertSchema('Case', submitted.case);
  assert.equal(submitted.request.status, 'submitted');
  assert.equal(submitted.request.caseId, submitted.case.id);
  assert.equal(submitted.case.status, 'awaiting_payment');
  assert.equal(submitted.case.channel, 'web');
  assert.equal(submitted.case.administrationId, 'justice');
  assert.match(submitted.case.reference, /^SIM-JUS-\d{4}-\d{6}$/);
  assert.deepEqual(
    submitted.case.documents.map((document: any) => [document.kind, document.documentType]),
    [['submitted', 'extrait-acte-naissance']],
    'la pièce a été transmise au X-Road',
  );
  assert.deepEqual(ok(await act(s, 'request.submit', { requestId }, { mandateId, channel: 'web', key })), submitted, 'rejeu idempotent');
  assert.equal(toolError(await act(s, 'request.submit', { requestId }, { mandateId, channel: 'web' })).code, 'INVALID_TRANSITION');
  assert.equal(toolError(await act(s, 'request.update', { requestId, fields: [{ name: 'profession', value: 'X', source: 'answer' }] }, { mandateId })).code, 'INVALID_TRANSITION');

  const paid = ok(await act(s, 'request.pay', { requestId }, { mandateId }));
  assertSchema('Case', paid);
  assert.equal(paid.payment.status, 'paid');
  assert.equal(paid.payment.amountFcfa, 1900);
  assert.equal(paid.status, 'in_review', 'vérification par un agent de la Justice');
  assert.equal(ok(await act(s, 'request.pay', { requestId }, { mandateId })).payment.reference, paid.payment.reference, 'jamais deux paiements');
  assert.equal(ok(await act(s, 'case.status', { requestId })).status, 'in_review');

  assert.equal(await s.tracker.tick(), 1);
  assert.deepEqual(await caseEvents(s), [], 'aucun changement depuis la réponse de l’outil');

  const caseId = paid.id;
  assert.equal((await s.xroad.official(JUSTICE_AGENT, 'POST', `/v1/cases/${caseId}/actions`, { action: 'claim', note: null })).status, 200);
  const asked = await s.xroad.official(JUSTICE_AGENT, 'POST', `/v1/cases/${caseId}/actions`, { action: 'request_information', note: 'Merci de fournir un acte de naissance lisible.' });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  await rows(s, 'update requests set next_check_at = now()');
  assert.equal(await s.tracker.tick(), 1);
  const [information] = await caseEvents(s);
  assert.equal(information.conversationId, ready.conversationId);
  assert.equal(information.case.status, 'information_requested');
  assert.equal(information.case.informationRequest.note, 'Merci de fournir un acte de naissance lisible.');

  const answered = ok(
    await act(
      s,
      'case.respond',
      { requestId, message: 'Voici une copie plus lisible.', fields: {}, fileIds: [{ documentType: 'extrait-acte-naissance', fileId: s.backend.addFile() }] },
      { mandateId },
    ),
  );
  assert.equal(answered.status, 'in_review');
  assert.equal(answered.documents.filter((document: any) => document.kind === 'submitted').length, 2);
  assert.equal(toolError(await act(s, 'case.respond', { requestId, message: 'Encore', fields: {}, fileIds: [] }, { mandateId })).code, 'INVALID_TRANSITION', 'plus de complément attendu');

  const approved = await s.xroad.official(JUSTICE_AGENT, 'POST', `/v1/cases/${caseId}/actions`, { action: 'approve', note: null });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  await rows(s, 'update requests set next_check_at = now()');
  assert.equal(await s.tracker.tick(), 1);
  const events = await caseEvents(s);
  assert.deepEqual(events.map((event) => event.case.status), ['information_requested', 'completed']);
  const completed = events[1].case;
  assert.equal(completed.completedBy, 'administration');
  assert.equal(completed.documents.filter((document: any) => document.kind === 'issued').length, 1, 'document délivré');
  assert.equal(await s.tracker.tick(), 0, 'suivi terminé');
});

test('acte de naissance sécurisé : complété par l’assistant seul après paiement, suivi clos sans événement en double', async (t) => {
  const s = await startStack(t);
  const mandateId = await grantMandate(s, ACTE);
  const created = ok(await act(s, 'request.create', { procedureId: ACTE }, { mandateId }));
  assert.equal(created.administrationId, 'anip');
  assert.deepEqual(created.fields, []);
  assert.equal(created.missing.length, 2);
  for (const document of created.documents) {
    ok(await act(s, 'documents.attach', { requestId: created.id, documentType: document.documentType, fileId: s.backend.addFile(undefined, 'image/jpeg') }, { mandateId }));
  }
  const submitted = ok(await act(s, 'request.submit', { requestId: created.id }, { mandateId, channel: 'whatsapp' }));
  assert.equal(submitted.case.channel, 'whatsapp');
  const paid = ok(await act(s, 'request.pay', { requestId: created.id }, { mandateId }));
  assert.equal(paid.status, 'completed');
  assert.equal(paid.completedBy, 'assistant');
  assert.ok(paid.documents.some((document: any) => document.kind === 'issued'));
  assert.equal(await s.tracker.tick(), 1);
  assert.deepEqual(await caseEvents(s), [], 'le Backend a déjà le dossier par la réponse de l’outil');
  assert.equal(await s.tracker.tick(), 0);
  const anip = await s.xroad.official(ANIP_AGENT, 'GET', '/v1/cases?view=completed');
  assert.ok(anip.body.items.some((item: any) => item.id === paid.id), 'arrive directement dans Complété de l’ANIP');
});

test('X-Road injoignable : erreur UPSTREAM_UNAVAILABLE, rien n’est déposé, nouvel essai possible', async (t) => {
  const s = await startStack(t, { XROAD_URL: 'http://127.0.0.1:9' });
  const result = await act(s, 'procedures.get', { procedureId: CASIER });
  assert.equal(toolError(result).code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(toolError(result).detail, 'X-Road indisponible');
});
