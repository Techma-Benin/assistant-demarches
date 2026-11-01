import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATALOGUE, FILINGS, officialDays, officialFee } from '../src/data.js';
import { domainValidator } from '../src/contracts.js';
import { XroadStore } from '../src/store.js';

const imported = JSON.parse(readFileSync(new URL('../../../../content/service-public/catalogue.json', import.meta.url), 'utf8')) as {
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
  assert.ok(CATALOGUE.length > 200, 'catalogue officiel complet');
  for (const { procedure } of CATALOGUE) {
    assert.ok(valid(procedure), `${procedure.id} : ${JSON.stringify(valid.errors)}`);
    assert.equal(procedure.source.url, `https://service-public.bj/public/services/service/${procedure.id}`);
    assert.equal(procedure.official.serviceId, procedure.id);
  }
  assert.doesNotMatch(JSON.stringify(CATALOGUE), /example\.(org|com|net)/, 'aucun domaine d’exemple');
});

test('seuls les liens de canal vérifiés à l’import sont montrés', () => {
  const checked = new Map<string, string>();
  for (const service of imported.services) {
    for (const channel of [service.online, service.inPerson]) if (channel?.url) checked.set(channel.url, channel.urlStatus);
  }
  for (const { procedure } of CATALOGUE) {
    for (const channel of [procedure.official.online, procedure.official.inPerson]) {
      if (channel?.url) assert.equal(checked.get(channel.url), 'ok', `${procedure.id} : ${channel.url}`);
    }
  }
});

test('démarches déposables : montant, délai, pièces et champs repris de la fiche officielle', () => {
  const fileable = CATALOGUE.filter((entry) => entry.rule).map((entry) => entry.procedure.id);
  assert.deepEqual(fileable.sort(), Object.keys(FILINGS).sort());
  for (const [id, filing] of Object.entries(FILINGS)) {
    const amount = String(filing.feeFcfa);
    assert.match(said(id, 'fee').replace(/[ .]/g, ''), new RegExp(`\\b${amount}\\s*F`), `${id} : coût ${amount}`);
    if (filing.processingDays === null) assert.equal(said(id, 'delay').trim(), '', `${id} : délai non publié`);
    else assert.match(said(id, 'delay'), new RegExp(`\\b${filing.processingDays * 24}\\s*h`), `${id} : délai`);
    for (const name of [...filing.requiredDocuments, ...Object.keys(filing.fields)]) {
      assert.ok(OFFICIAL_WORDING[name], `${id} : ${name} sans correspondance officielle`);
      assert.match(said(id, 'documents'), OFFICIAL_WORDING[name], `${id} : ${name}`);
    }
  }
});

test('recherche : la question d’un usager trouve la bonne fiche officielle en premier', () => {
  const store = new XroadStore({ seedHistory: false });
  const first = (question: string) => store.searchProcedures(question, undefined)[0]?.id;
  assert.equal(first('comment renouveler mon passeport ?'), 'PS00328');
  assert.equal(first('obtenir mon casier judiciaire'), 'PS00373');
  assert.equal(first("acte de naissance"), 'PS00393');
  assert.equal(first("carte d'identité"), 'PS00406');
  assert.equal(first('créer une entreprise'), 'PS00062');
  assert.equal(first('authentifier mon diplôme'), 'PS00254');
  assert.deepEqual(store.searchProcedures('comment obtenir', undefined), [], 'aucun mot utile : aucune fiche au hasard');
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
