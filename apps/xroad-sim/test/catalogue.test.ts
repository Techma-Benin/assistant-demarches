import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEMO_OFFICIALS, FILINGS, loadCatalogue, officialDays, officialFee } from '../src/data.js';
import { domainValidator } from '../src/contracts.js';
import { XroadStore } from '../src/store.js';
import { CATALOGUE_FILE } from './helpers.js';

const catalogue = loadCatalogue(CATALOGUE_FILE);
const imported = JSON.parse(readFileSync(CATALOGUE_FILE, 'utf8')) as {
  services: { id: string; online: Record<string, any> | null; inPerson: Record<string, any> | null }[];
};
const official = (id: string) => {
  const service = imported.services.find((candidate) => candidate.id === id);
  assert.ok(service, `fiche officielle ${id} absente de l'import`);
  return [service.online, service.inPerson].filter(Boolean) as Record<string, any>[];
};
const said = (id: string, key: 'fee' | 'delay' | 'documents') => official(id).map((channel) => channel[key] ?? '').join('\n');

/** Where each document type and form field of a filing appears in the official sheet. */
const OFFICIAL_WORDING: Record<string, RegExp> = {
  'extrait-acte-naissance': /Extrait d'acte de naissance/,
  'recepisse-ravip': /récépissé RAVIP/,
  'ancien-acte-naissance': /ancien acte de naissance/,
  'acte-naissance': /copie de l’acte de naissance/,
  'justificatif-residence': /attestation de résidence ou facture SBEE\/SONEB/,
  'diplome-a-authentifier': /Copie du diplôme à authentifier/,
  'diplome-entree-formation': /Copie du diplôme d’entrée dans la formation/,
  adresseDomicile: /l'adresse du domicile/,
  profession: /la profession/,
  nombreEnfantsACharge: /le nombre d'enfants à charge/,
  situationMatrimoniale: /la situation matrimoniale/,
};

test('chaque fiche servie est conforme au contrat et pointe vers sa fiche service-public.bj', () => {
  const valid = domainValidator('Procedure');
  assert.ok(catalogue.entries.length > 200, 'catalogue officiel complet');
  for (const { procedure } of catalogue.entries) {
    assert.ok(valid(procedure), `${procedure.id} : ${JSON.stringify(valid.errors)}`);
    assert.equal(procedure.source.url, `https://service-public.bj/public/services/service/${procedure.id}`);
  }
  assert.doesNotMatch(JSON.stringify(catalogue.entries), /example\.(org|com|net)/, 'aucun domaine d’exemple');
});

test('seuls les liens de canal vérifiés à l’import sont montrés', () => {
  const checked = new Map<string, string>();
  for (const service of imported.services) {
    for (const channel of [service.online, service.inPerson]) if (channel?.url) checked.set(channel.url, channel.urlStatus);
  }
  for (const { procedure } of catalogue.entries) {
    for (const channel of [procedure.online, procedure.inPerson]) {
      if (channel?.url) assert.equal(checked.get(channel.url), 'ok', `${procedure.id} : ${channel.url}`);
    }
  }
});

test('démarches déposables : montant, délai, pièces et champs repris de la fiche officielle', () => {
  const fileable = catalogue.entries.filter((entry) => entry.rule).map((entry) => entry.procedure.id);
  assert.deepEqual(fileable.sort(), ['PS00254', 'PS00373', 'PS00392', 'PS00393']);
  assert.deepEqual(Object.keys(FILINGS).sort(), fileable);
  for (const [id, filing] of Object.entries(FILINGS)) {
    const amount = String(filing.feeFcfa);
    assert.match(said(id, 'fee').replace(/[ .]/g, ''), new RegExp(`\\b${amount}\\s*F`), `${id} : coût ${amount}`);
    if (filing.processingDays === null) assert.equal(said(id, 'delay').trim(), '', `${id} : délai non publié`);
    else assert.match(said(id, 'delay'), new RegExp(`\\b${filing.processingDays * 24}\\s*h`), `${id} : délai`);
    for (const name of [...filing.requiredDocuments.map((document) => document.documentType), ...Object.keys(filing.fields)]) {
      assert.ok(OFFICIAL_WORDING[name], `${id} : ${name} sans correspondance officielle`);
      assert.match(said(id, 'documents'), OFFICIAL_WORDING[name], `${id} : ${name}`);
    }
  }
});

test('démarches déposables : administration destinataire et règle d’instruction du contrat', () => {
  const entry = (id: string) => catalogue.entries.find((candidate) => candidate.procedure.id === id)!;
  assert.equal(entry('PS00373').procedure.administrationId, 'justice');
  assert.notEqual(entry('PS00373').rule?.blocker, null, 'casier judiciaire : vérifié par un agent');
  for (const [id, administrationId] of [['PS00393', 'anip'], ['PS00392', 'anip'], ['PS00254', 'enseignement']]) {
    assert.equal(entry(id).procedure.administrationId, administrationId);
    assert.equal(entry(id).rule?.blocker, null, `${id} : complété par l’assistant`);
  }
  assert.equal(entry('PS00328').procedure.filing, null, 'passeport : information seulement');
});

test('annuaire de démo : mêmes identifiants, courriels et noms que le realm Keycloak', () => {
  const realm = JSON.parse(readFileSync(new URL('../../../../infra/keycloak/realm-techma.json', import.meta.url), 'utf8')) as {
    users: { id?: string; email?: string; firstName?: string; lastName?: string; realmRoles?: string[] }[];
  };
  const officials = realm.users.filter((user) => user.realmRoles?.includes('official'));
  assert.equal(officials.length, DEMO_OFFICIALS.length);
  const valid = domainValidator('Official');
  for (const user of officials) {
    const found = DEMO_OFFICIALS.find((candidate) => candidate.subject === user.id);
    assert.ok(found, `${user.email} absent de l'annuaire`);
    assert.equal(found.email, user.email);
    assert.equal(found.displayName, `${user.firstName} ${user.lastName}`);
    assert.ok(valid(found), JSON.stringify(valid.errors));
  }
  assert.deepEqual(DEMO_OFFICIALS.filter((candidate) => candidate.role === 'super_admin').map((candidate) => candidate.administrationId), [null]);
});

test('recherche : la question d’un usager trouve la bonne fiche officielle en premier', () => {
  const store = new XroadStore(catalogue);
  const first = (question: string) => store.searchProcedures(question)[0]?.id;
  assert.equal(first('comment renouveler mon passeport ?'), 'PS00328');
  assert.equal(first('obtenir mon casier judiciaire'), 'PS00373');
  assert.equal(first('acte de naissance'), 'PS00393');
  assert.equal(first("carte d'identité"), 'PS00406');
  assert.equal(first('créer une entreprise'), 'PS00062');
  assert.equal(first('authentifier mon diplôme'), 'PS00254');
  assert.deepEqual(store.searchProcedures('comment obtenir'), [], 'aucun mot utile : aucune fiche au hasard');
});

test('coût et délai : une seule valeur sans condition, sinon null', () => {
  assert.equal(officialFee('1 900 FCFA'), 1900);
  assert.equal(officialFee('10.000 Francs CFA'), 10000);
  assert.equal(officialFee('Gratuit'), 0);
  assert.equal(officialFee('Variable'), null);
  assert.equal(officialFee('10.000 Francs CFA, soit environ 16 Euros'), null);
  assert.equal(officialFee(null), null);
  assert.equal(officialDays('72h'), 3);
  assert.equal(officialDays('24 heures'), 1);
  assert.equal(officialDays('10 Jours'), 10);
  assert.equal(officialDays('Instantané'), 0);
  assert.equal(officialDays('72h (Due à une forte demande, le délai peut être plus long)'), null);
  assert.equal(officialDays('entre 3 à 6 mois'), null);
});
