import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ConfigError, loadConfig } from '../src/config.js';
import { createXroadServer } from '../src/server.js';
import {
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
  startSim,
  uploadId,
} from './helpers.js';

const file = (documentType: string) => ({ documentType, uploadId: uploadId() });
const CASIER_FIELDS = { adresseDomicile: 'Cotonou, Cadjèhoun', profession: 'Comptable', nombreEnfantsACharge: 2, situationMatrimoniale: 'Marié' };
const casier = (fields: Record<string, unknown> = CASIER_FIELDS) => caseInput('PS00373', fields, ['extrait-acte-naissance']);
const acteNaissance = () => caseInput('PS00393', {}, ['recepisse-ravip', 'ancien-acte-naissance']);
const diplome = () => caseInput('PS00254', {}, ['diplome-a-authentifier', 'diplome-entree-formation']);
const caseInput = (procedureId: string, fields: Record<string, unknown>, documentTypes: string[]) => ({
  requestId: requestId(),
  procedureId,
  channel: 'web' as const,
  fields,
  documents: documentTypes.map(file),
});

test('catalogue : administrations officielles, recherche sans accents, filtre et fiche inconnue', async (t) => {
  const { url } = await startSim(t);
  const administrations = await call(url, 'GET', '/v1/administrations?limit=100', { token: TOOLING });
  assertConforms('xroadListAdministrations', administrations, 200);
  assert.deepEqual(
    administrations.body.items.filter((item: any) => item.connection.status === 'connected').map((item: any) => item.id),
    ['justice', 'enseignement', 'anip'],
  );
  const interieur = administrations.body.items.find((item: any) => item.id === 'interieur');
  assert.equal(interieur.name, "Ministère de l'Intérieur et de la Sécurité Publique");
  assert.equal(interieur.connection.status, 'not_connected');

  const search = await call(url, 'GET', '/v1/procedures?query=casier%20judiciaire', { token: TOOLING });
  assertConforms('xroadSearchProcedures', search, 200);
  assert.equal(search.body.items[0].id, 'PS00373');
  const accents = await call(url, 'GET', `/v1/procedures?query=${encodeURIComponent('acte de naissance securise')}`, { token: BACKEND });
  assert.ok(accents.body.items.some((item: any) => item.id === 'PS00393'), 'recherche insensible aux accents');
  const justice = await call(url, 'GET', '/v1/procedures?administrationId=justice', { token: TOOLING });
  assert.ok(justice.body.items.length > 1);
  assert.ok(justice.body.items.every((item: any) => item.administrationId === 'justice'));

  const procedure = await call(url, 'GET', '/v1/procedures/PS00373', { token: TOOLING });
  assertConforms('xroadGetProcedure', procedure, 200);
  assert.equal(procedure.body.filing?.requiredDocuments[0].documentType, 'extrait-acte-naissance');
  assert.equal(procedure.body.source.url, 'https://service-public.bj/public/services/service/PS00373');
  assert.ok(procedure.body.filing);
  assert.equal(procedure.body.online.fee, '1 900 FCFA');
  const information = await call(url, 'GET', '/v1/procedures/PS00328', { token: TOOLING });
  assertConforms('xroadGetProcedure', information, 200);
  assert.equal(information.body.filing, null, 'passeport : information seulement');
  assertConforms('xroadGetProcedure', await call(url, 'GET', '/v1/procedures/inconnue', { token: TOOLING }), 404);
});

test('fiche d’information seulement : dépôt refusé définitivement, avec le lien officiel', async (t) => {
  const { url } = await startSim(t);
  const refused = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: caseInput('PS00024', {}, []) });
  assertConforms('xroadCreateCase', refused, 409);
  assert.equal(refused.body.code, 'INVALID_TRANSITION');
  assert.match(refused.body.detail, /https:\/\/service-public\.bj\/public\/services\/service\/PS00024/);
});

test('sécurité : jeton, identité de service, scope, traceparent et en-têtes de contexte', async (t) => {
  const { url } = await startSim(t);
  const noToken = await call(url, 'GET', '/v1/administrations');
  assertConforms('xroadListAdministrations', noToken, 401);
  assert.equal(noToken.headers.get('www-authenticate'), 'Bearer');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: 'forged' })).status, 401);
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: TOOLING, traceparent: null })).status, 400);
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: TOOLING, traceparent: `00-${'0'.repeat(32)}-${'1'.repeat(16)}-01` })).status, 400);

  // The Tooling acts for applicants only, the Backend for officials only.
  assertConforms('xroadListCases', await call(url, 'GET', '/v1/cases', { token: TOOLING, official: JUSTICE_AGENT }), 403);
  assertConforms('xroadCreateCase', await call(url, 'POST', '/v1/cases', { token: BACKEND, applicant: APPLICANT, body: diplome() }), 403);
  assert.equal((await call(url, 'POST', '/v1/cases', { token: TOOLING, body: diplome() })).status, 400, 'X-Applicant-Ref requis');
  assert.equal((await call(url, 'GET', '/v1/cases', { token: BACKEND, official: `off_${'Z'.repeat(26)}` })).status, 403, 'agent inconnu');
});

test('dossier complété seul par l’assistant : paiement simulé, document délivré et téléchargé', async (t) => {
  const { url } = await startSim(t);
  const created = await call(url, 'POST', '/v1/cases', {
    token: TOOLING,
    applicant: APPLICANT,
    body: acteNaissance(),
  });
  assertConforms('xroadCreateCase', created, 201);
  assert.equal(created.body.status, 'awaiting_payment');
  assert.equal(created.body.administrationId, 'anip');
  assert.equal(created.body.simulated, true);
  assert.match(created.body.reference, /^SIM-ANIP-2026-\d{6}$/);
  assert.equal(created.body.payment.status, 'pending');
  assert.equal(created.body.payment.simulated, true);

  const paid = await call(url, 'POST', `/v1/cases/${created.body.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  assertConforms('xroadPayCase', paid, 200);
  assert.equal(paid.body.status, 'completed');
  assert.equal(paid.body.completedBy, 'assistant');
  assert.equal(paid.body.payment.status, 'paid');
  assert.ok(paid.body.steps.every((step: any) => step.state === 'done'), 'aucune étape en attente');
  const issued = (item: any) => (item.documents as any[]).filter((document) => document.kind === 'issued');
  assert.equal(issued(paid.body).length, 1);

  const again = await call(url, 'POST', `/v1/cases/${created.body.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  assertConforms('xroadPayCase', again, 409);
  assert.equal(again.body.code, 'INVALID_TRANSITION');

  const documentPath = `/v1/cases/${created.body.id}/documents/${issued(paid.body)[0].id}`;
  const pdf = await call(url, 'GET', documentPath, { token: TOOLING, applicant: APPLICANT });
  assertConforms('xroadDownloadDocument', pdf, 200);
  assert.equal(pdf.raw.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.raw.toString('latin1'), /SIMULATION - SANS VALEUR ADMINISTRATIVE/);
  assert.match(pdf.raw.toString('latin1'), new RegExp(created.body.reference));
  const latin1 = pdf.raw.toString('latin1');
  const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(latin1)?.[1]);
  assert.equal(latin1.slice(xref, xref + 4), 'xref', 'startxref pointe sur la table');
  const offsets = [...latin1.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((offset, index) => assert.equal(latin1.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`, `objet ${index + 1}`));

  // Another applicant, or an official of another administration, learns nothing.
  assertConforms('xroadGetCase', await call(url, 'GET', `/v1/cases/${created.body.id}`, { token: TOOLING, applicant: OTHER_APPLICANT }), 404);
  assert.equal((await call(url, 'GET', documentPath, { token: TOOLING, applicant: OTHER_APPLICANT })).status, 404);
  assert.equal((await call(url, 'GET', `/v1/cases/${created.body.id}`, { token: BACKEND, official: JUSTICE_AGENT })).status, 404);
  assert.equal((await call(url, 'GET', `/v1/cases/${created.body.id}`, { token: TOOLING, applicant: APPLICANT, official: ENSEIGNEMENT_AGENT })).status, 400);
});

test('casier judiciaire : nouvelle demande à vérifier par la Justice, jamais complétée seule', async (t) => {
  const { url } = await startSim(t);
  const created = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier() });
  const paid = await call(url, 'POST', `/v1/cases/${created.body.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  assertConforms('xroadPayCase', paid, 200);
  assert.equal(paid.body.status, 'in_review');
  assert.equal(paid.body.completedBy, null);
  assert.match(paid.body.steps.find((step: any) => step.state === 'blocked').note, /^Nouvelle demande à vérifier/);
  assert.deepEqual((await call(url, 'GET', '/v1/cases?view=pending', { token: BACKEND, official: JUSTICE_AGENT })).body.items.map((item: any) => item.id), [created.body.id]);
  assert.deepEqual((await call(url, 'GET', '/v1/cases?view=pending', { token: BACKEND, official: ENSEIGNEMENT_AGENT })).body.items, []);
});

test('décision relayée par le Tooling depuis la console : X-Actor-Ref, scope dédié, un seul en-tête', async (t) => {
  const { url } = await startSim(t);
  const created = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier() });
  await call(url, 'POST', `/v1/cases/${created.body.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  const path = `/v1/cases/${created.body.id}/actions`;
  const decide = (headers: Record<string, string>, token = TOOLING) =>
    fetch(url + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, traceparent: `00-${'3'.repeat(32)}-${'4'.repeat(16)}-01`, 'content-type': 'application/json', 'idempotency-key': key(), ...headers },
      body: JSON.stringify({ action: 'approve', note: 'Identité confirmée' }),
    }).then(async (res) => ({ status: res.status, body: (await res.json()) as any, raw: Buffer.alloc(0), headers: res.headers }));

  assert.equal((await decide({})).status, 401, 'aucun en-tête');
  assert.equal((await decide({ 'x-official-subject': JUSTICE_AGENT })).status, 403, 'identité Tooling refusée pour une action agent');
  const approved = await decide({ 'x-official-subject': JUSTICE_AGENT }, BACKEND);
  assertConforms('xroadActOnCase', approved, 200);
  assert.equal(approved.body.status, 'completed');
  assert.equal(approved.body.completedBy, 'administration');
  assert.match(approved.body.steps.find((step: any) => step.actor === 'administration' && step.note)?.note ?? '', /Vérifié par/);
  assert.equal(approved.body.documents.filter((document: any) => document.kind === 'issued').length, 1);
});

test('redémarrage : dossiers, références, réponses idempotentes et affectations conservés dans le fichier d’état', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'xroad-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  const first = await createXroadServer(loadConfig({ XROAD_PORT: '0', XROAD_SEED_HISTORY: 'off', XROAD_STATE_FILE: stateFile })).listen();
  const input = casier();
  const filing = key();
  const created = await call(first.url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: input, idempotencyKey: filing });
  await call(first.url, 'PUT', `/v1/officials/${ENSEIGNEMENT_AGENT}/assignment`, { token: BACKEND, official: SUPER_ADMIN, body: { administrationId: 'justice', role: 'agent' } });
  await first.close();

  const second = await startSim(t, { XROAD_STATE_FILE: stateFile });
  const found = await call(second.url, 'GET', `/v1/cases/${created.body.id}`, { token: TOOLING, applicant: APPLICANT });
  assertConforms('xroadGetCase', found, 200);
  assert.deepEqual(found.body, created.body);
  const replay = await call(second.url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: input, idempotencyKey: filing });
  assert.equal(replay.status, 201, 'rejeu après redémarrage : même réponse');
  assert.deepEqual(replay.body, created.body);
  assert.equal((await call(second.url, 'GET', `/v1/cases/${created.body.id}`, { token: BACKEND, official: ENSEIGNEMENT_AGENT })).status, 200, 'affectation conservée');
  const next = await call(second.url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier({ ...CASIER_FIELDS, profession: 'Enseignant' }) });
  assert.equal(Number(next.body.reference.slice(-6)), Number(created.body.reference.slice(-6)) + 1, 'numérotation poursuivie');
});

test('dossier bloqué : visible seulement par son ministère, en attente, puis approuvé par un agent', async (t) => {
  const { url } = await startSim(t);
  const created = await call(url, 'POST', '/v1/cases', {
    token: TOOLING,
    applicant: APPLICANT,
    body: casier(),
  });
  const paid = await call(url, 'POST', `/v1/cases/${created.body.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  assert.equal(paid.body.status, 'in_review');
  const blocked = paid.body.steps.find((step: any) => step.state === 'blocked');
  assert.equal(blocked.actor, 'assistant');
  assert.match(blocked.note, /Centre national du casier judiciaire/);
  assert.deepEqual(paid.body.steps.at(-1), { id: 'decision', label: "Décision de l'administration", state: 'pending', actor: 'administration', note: null, at: null });

  const justice = await call(url, 'GET', '/v1/cases?view=pending', { token: BACKEND, official: JUSTICE_AGENT });
  assertConforms('xroadListCases', justice, 200);
  assert.deepEqual(justice.body.items.map((item: any) => item.id), [created.body.id]);
  const enseignement = await call(url, 'GET', '/v1/cases?view=pending', { token: BACKEND, official: ENSEIGNEMENT_AGENT });
  assert.deepEqual(enseignement.body.items, [], 'même interface, autres données');
  assertConforms('xroadListCases', await call(url, 'GET', '/v1/cases?administrationId=justice', { token: BACKEND, official: ENSEIGNEMENT_AGENT }), 403);
  assert.equal((await call(url, 'POST', `/v1/cases/${created.body.id}/actions`, { token: BACKEND, official: ENSEIGNEMENT_AGENT, body: { action: 'approve', note: null } })).status, 404);
  const everything = await call(url, 'GET', '/v1/cases?view=pending', { token: BACKEND, official: SUPER_ADMIN });
  assert.deepEqual(everything.body.items.map((item: any) => item.id), [created.body.id], 'le super administrateur voit tout');

  const approved = await call(url, 'POST', `/v1/cases/${created.body.id}/actions`, {
    token: BACKEND,
    official: JUSTICE_AGENT,
    body: { action: 'approve', note: 'Identité confirmée' },
  });
  assertConforms('xroadActOnCase', approved, 200);
  assert.equal(approved.body.status, 'completed');
  assert.equal(approved.body.completedBy, 'administration');
  assert.ok(approved.body.steps.every((step: any) => step.state === 'done'));
  assert.ok(approved.body.steps.some((step: any) => step.actor === 'administration' && step.state === 'done'));
  assert.equal(approved.body.documents.filter((document: any) => document.kind === 'issued').length, 1);

  const twice = await call(url, 'POST', `/v1/cases/${created.body.id}/actions`, { token: BACKEND, official: JUSTICE_AGENT, body: { action: 'reject', note: 'Trop tard' } });
  assertConforms('xroadActOnCase', twice, 409);
  const completed = await call(url, 'GET', '/v1/cases?view=completed', { token: BACKEND, official: JUSTICE_AGENT });
  assert.deepEqual(completed.body.items.map((item: any) => item.id), [created.body.id]);
  assert.equal((await call(url, 'GET', `/v1/cases/${created.body.id}`, { token: TOOLING, applicant: APPLICANT })).body.status, 'completed', 'l’usager voit la décision');
});

test('prise en charge : claim sur in_review, refus une fois clos, puis rejet depuis information_requested', async (t) => {
  const { url } = await startSim(t);
  const created = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier() });
  await call(url, 'POST', `/v1/cases/${created.body.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  const claimed = await call(url, 'POST', `/v1/cases/${created.body.id}/actions`, {
    token: BACKEND,
    official: JUSTICE_AGENT,
    body: { action: 'claim', note: null },
  });
  assertConforms('xroadActOnCase', claimed, 200);
  assert.equal(claimed.body.status, 'in_review');
  assert.equal(claimed.body.claimedBy, JUSTICE_AGENT);
  const asked = await call(url, 'POST', `/v1/cases/${created.body.id}/actions`, {
    token: BACKEND,
    official: JUSTICE_AGENT,
    body: { action: 'request_information', note: 'Acte illisible' },
  });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.status, 'information_requested');
  const rejected = await call(url, 'POST', `/v1/cases/${created.body.id}/actions`, {
    token: BACKEND,
    official: JUSTICE_AGENT,
    body: { action: 'reject', note: 'Pièce illisible' },
  });
  assertConforms('xroadActOnCase', rejected, 200);
  assert.equal(rejected.body.status, 'rejected');
  const late = await call(url, 'POST', `/v1/cases/${created.body.id}/actions`, {
    token: BACKEND,
    official: JUSTICE_AGENT,
    body: { action: 'claim', note: null },
  });
  assert.equal(late.status, 409);
});

test('rejet par un agent du ministère, sans document délivré', async (t) => {
  const { url } = await startSim(t);
  const created = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier() });
  await call(url, 'POST', `/v1/cases/${created.body.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });
  const rejected = await call(url, 'POST', `/v1/cases/${created.body.id}/actions`, {
    token: BACKEND,
    official: JUSTICE_AGENT,
    body: { action: 'reject', note: "Extrait d'acte de naissance illisible" },
  });
  assertConforms('xroadActOnCase', rejected, 200);
  assert.equal(rejected.body.status, 'rejected');
  assert.equal(rejected.body.documents.filter((document: any) => document.kind === 'issued').length, 0);
  assert.equal(rejected.body.steps.find((step: any) => step.id === 'decision').note, "Extrait d'acte de naissance illisible");
});

test('dépôt refusé : formulaire, pièces, doublon, corps invalide et type de contenu', async (t) => {
  const { url } = await startSim(t);
  const missing = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: caseInput('PS00393', {}, ['recepisse-ravip']) });
  assertConforms('xroadCreateCase', missing, 409);
  assert.equal(missing.body.code, 'REQUEST_INCOMPLETE');
  assert.match(missing.body.detail, /ancien-acte-naissance/);

  const badField = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier({ ...CASIER_FIELDS, nombreEnfantsACharge: -1 }) });
  assert.equal(badField.body.code, 'REQUEST_INCOMPLETE');
  const unknownField = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier({ ...CASIER_FIELDS, nom: 'x' }) });
  assert.equal(unknownField.body.code, 'REQUEST_INCOMPLETE', 'aucun champ hors formulaire');

  const input = diplome();
  assert.equal((await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: input })).status, 201);
  const duplicate = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: input });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'INVALID_TRANSITION');

  assertConforms('xroadCreateCase', await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: { ...input, requestId: 'req_1' } }), 400);
  assertConforms('xroadCreateCase', await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: input, contentType: 'text/plain' }), 415);
  assert.equal((await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: input, idempotencyKey: 'court' })).status, 400);
});

test('idempotence : même clé et même corps rejoue la première réponse, autre corps refusé', async (t) => {
  const { url } = await startSim(t);
  const idempotencyKey = key();
  const input = casier();
  const first = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: input, idempotencyKey });
  await call(url, 'POST', `/v1/cases/${first.body.id}/payment`, { token: TOOLING, applicant: APPLICANT, body: { method: 'mobile_money' } });

  const replay = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: input, idempotencyKey });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, first.body, 'réponse d’origine, pas l’état courant');
  const conflict = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: { ...input, fields: { ...CASIER_FIELDS, profession: 'Enseignant' } }, idempotencyKey });
  assertConforms('xroadCreateCase', conflict, 409);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
  const otherApplicant = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: OTHER_APPLICANT, body: input, idempotencyKey });
  assert.equal(otherApplicant.body.code, 'IDEMPOTENCY_CONFLICT', 'la clé couvre aussi l’identité représentée');
});

test('agents : liste selon le rôle, profil, affectation réservée au super administrateur', async (t) => {
  const { url } = await startSim(t);
  const all = await call(url, 'GET', '/v1/officials', { token: BACKEND });
  assertConforms('xroadListOfficials', all, 200);
  assert.equal(all.body.items.length, 7, 'écran « se connecter en tant que »');
  assert.deepEqual((await call(url, 'GET', '/v1/officials', { token: BACKEND, official: JUSTICE_AGENT })).body.items.map((item: any) => item.id), [JUSTICE_AGENT]);
  const admin = await call(url, 'GET', '/v1/officials', { token: BACKEND, official: JUSTICE_ADMIN });
  assert.deepEqual(new Set(admin.body.items.map((item: any) => item.administrationId)), new Set(['justice']));
  const me = await call(url, 'GET', '/v1/officials/me', { token: BACKEND, official: JUSTICE_AGENT });
  assertConforms('xroadGetMe', me, 200);
  assert.equal(me.body.official.role, 'agent');

  const denied = await call(url, 'PUT', `/v1/officials/${ENSEIGNEMENT_AGENT}/assignment`, { token: BACKEND, official: JUSTICE_ADMIN, body: { administrationId: 'justice', role: 'agent' } });
  assert.equal(denied.status, 403);
  const moved = await call(url, 'PUT', `/v1/officials/${ENSEIGNEMENT_AGENT}/assignment`, { token: BACKEND, official: SUPER_ADMIN, body: { administrationId: 'justice', role: 'agent' } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.administrationId, 'justice');

  // The moved official now sees Justice cases, with exactly the same interface.
  const created = await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier() });
  assert.equal((await call(url, 'GET', `/v1/cases/${created.body.id}`, { token: BACKEND, official: ENSEIGNEMENT_AGENT })).status, 200);

  assert.equal((await call(url, 'PUT', `/v1/officials/${JUSTICE_AGENT}/assignment`, { token: BACKEND, official: SUPER_ADMIN, body: { administrationId: 'justice', role: 'super_admin' } })).status, 400);
  assert.equal((await call(url, 'PUT', `/v1/officials/${JUSTICE_AGENT}/assignment`, { token: BACKEND, official: SUPER_ADMIN, body: { administrationId: 'atlantide', role: 'agent' } })).status, 400);
  const last = await call(url, 'PUT', `/v1/officials/${SUPER_ADMIN}/assignment`, { token: BACKEND, official: SUPER_ADMIN, body: { administrationId: 'justice', role: 'admin' } });
  assert.equal(last.body.code, 'INVALID_TRANSITION', 'au moins un super administrateur');
});

test('indicateurs : historique fictif, cohérence avec les listes, périmètre par administration', async (t) => {
  const { url } = await startSim(t, { XROAD_SEED_HISTORY: 'on' });
  const justice = await call(url, 'GET', '/v1/metrics', { token: BACKEND, official: JUSTICE_AGENT });
  assertConforms('xroadGetMetrics', justice, 200);
  assert.equal(justice.body.administrationId, 'justice');
  assert.ok(justice.body.received > 0);
  assert.ok(justice.body.completedByAssistant <= justice.body.completed);
  assert.ok(justice.body.topProcedures.every((entry: any) => entry.procedureId === 'PS00373'));

  const pending: any[] = [];
  let cursor: string | null = '';
  while (cursor !== null) {
    const listed: any = await call(url, 'GET', `/v1/cases?view=pending&limit=2${cursor ? `&cursor=${cursor}` : ''}`, { token: BACKEND, official: JUSTICE_AGENT });
    assertConforms('xroadListCases', listed, 200);
    pending.push(...listed.body.items);
    cursor = listed.body.nextCursor;
  }
  assert.equal(pending.length, justice.body.pending);
  assert.deepEqual(pending.map((item) => item.createdAt), [...pending.map((item) => item.createdAt)].sort(), 'le plus ancien en premier');

  const history = await call(url, 'GET', '/v1/cases?limit=100', { token: BACKEND, official: SUPER_ADMIN });
  assertConforms('xroadListCases', history, 200);
  assert.ok(history.body.items.some((item: any) => item.completedBy === 'assistant') && history.body.items.some((item: any) => item.status === 'rejected'));

  const all = await call(url, 'GET', '/v1/metrics', { token: BACKEND, official: SUPER_ADMIN });
  assert.equal(all.body.administrationId, null);
  assert.ok(all.body.received > justice.body.received);
  assertConforms('xroadGetMetrics', await call(url, 'GET', '/v1/metrics?administrationId=sante', { token: BACKEND, official: JUSTICE_AGENT }), 403);
  assert.equal((await call(url, 'GET', '/v1/cases?limit=0', { token: BACKEND, official: JUSTICE_AGENT })).status, 400);
});

test('vue des connexions : administrations et derniers échanges, sans donnée personnelle', async (t) => {
  const { url } = await startSim(t);
  await call(url, 'POST', '/v1/cases', { token: TOOLING, applicant: APPLICANT, body: casier() });
  const res = await fetch(`${url}/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Non connectée : connexion recommandée/);
  assert.match(html, /createXroadCase/);
  assert.equal(html.includes(APPLICANT), false);
  assert.deepEqual(await (await fetch(`${url}/health`)).json(), { status: 'ok', simulated: true });
});

test('configuration : jetons statiques réservés au poste local, JWT vérifié en audience et émetteur', async (t) => {
  assert.throws(() => loadConfig({ XROAD_HOST: '0.0.0.0' }), ConfigError);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'mock-tokens' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'jwt', JWT_JWKS_URL: 'http://idp.example/jwks', JWT_ISSUER: 'x' }), ConfigError, 'JWKS en HTTPS');

  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const idp = http.createServer((_, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] })));
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => idp.close(() => resolve())));
  const issuer = 'https://idp.example/realms/techma';
  const { url } = await startSim(t, { AUTH_MODE: 'jwt', JWT_ISSUER: issuer, JWT_JWKS_URL: `http://127.0.0.1:${(idp.address() as AddressInfo).port}/jwks` });
  const token = (audience: string, scope: string) =>
    new SignJWT({ azp: 'tooling-xroad', scope })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  assert.equal((await call(url, 'GET', '/v1/administrations', { token: await token('techma-xroad', 'xroad:apply') })).status, 200);
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: await token('techma-tooling', 'xroad:apply') })).status, 401, 'autre audience');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: await token('techma-xroad', 'xroad:submit') })).status, 403, 'scope absent');
  assert.equal((await call(url, 'GET', '/v1/administrations', { token: TOOLING })).status, 401, 'jeton statique refusé en mode JWT');
});
