import { describe, expect, it } from 'vitest';
import type { FormField } from '../src/contracts/types.js';
import { advanceForm, questionText, startFormSession } from '../src/rendering/form-session.js';
import type { FormSession } from '../src/rendering/types.js';

const fields: FormField[] = [
  { name: 'nom', label: 'Quel est votre nom ?', required: true, type: 'text' },
  { name: 'age', label: 'Quel est votre âge ?', required: true, type: 'number' },
  { name: 'naissance', label: 'Date de naissance ?', required: false, type: 'date' },
  { name: 'note', label: 'Une remarque ?', required: false, type: 'text' },
];
const start = () => startFormSession('form-1', fields, new Date('2026-10-25T10:00:00Z'));
const bodyOf = (m: { type: string; text?: { body: string } }) => m.text?.body ?? '';

describe('machine d’état des formulaires', () => {
  it('formule les questions avec les mentions facultatif et type', () => {
    expect(questionText(fields[0]!)).toBe('Quel est votre nom ?');
    expect(questionText(fields[1]!)).toBe('Quel est votre âge ?\nRépondez par un nombre.');
    expect(questionText(fields[2]!)).toBe(
      'Date de naissance ? (facultatif : répondez « passer » pour ignorer)\nRépondez au format JJ/MM/AAAA.',
    );
  });

  it('enchaîne les questions et produit le contenu d’interaction final', () => {
    let session: FormSession = start();
    const answers = ['Awa', '32,5', '01/02/1990', 'rien'];
    let last;
    for (const answer of answers) {
      last = advanceForm(session, answer);
      if (last.kind !== 'complete') session = last.session;
    }
    expect(last).toEqual({
      kind: 'complete',
      values: { nom: 'Awa', age: '32.5', naissance: '1990-02-01', note: 'rien' },
      content: {
        type: 'interaction',
        actionId: 'form-1',
        value: JSON.stringify({ nom: 'Awa', age: '32.5', naissance: '1990-02-01', note: 'rien' }),
      },
    });
  });

  it('« passer » ignore un champ facultatif (valeur vide) mais pas un champ obligatoire numérique', () => {
    const session: FormSession = { ...start(), index: 2, values: { nom: 'Awa', age: '3' } };
    const step = advanceForm(session, ' Passer ');
    expect(step.kind).toBe('next');
    if (step.kind === 'next') expect(step.session.values['naissance']).toBe('');

    const required = advanceForm({ ...start(), index: 1 }, 'passer');
    expect(required.kind).toBe('reask');
  });

  it('refuse un nombre invalide et repose la question', () => {
    const step = advanceForm({ ...start(), index: 1 }, 'douze');
    expect(step.kind).toBe('reask');
    if (step.kind === 'reask') {
      expect(bodyOf(step.reply as never)).toContain('Je n’ai pas compris le nombre.');
      expect(bodyOf(step.reply as never)).toContain('Quel est votre âge ?');
    }
  });

  it('valide les dates calendaires (31/02/2026 invalide)', () => {
    const base: FormSession = { ...start(), index: 2 };
    for (const bad of ['31/02/2026', '2026-02-01', '1/13/2026', 'demain']) {
      const step = advanceForm(base, bad);
      expect(step.kind, bad).toBe('reask');
      if (step.kind === 'reask') expect(bodyOf(step.reply as never)).toContain('Je n’ai pas compris la date. Répondez au format JJ/MM/AAAA.');
    }
    expect(advanceForm(base, '29/02/2028').kind).toBe('next');
    expect(advanceForm(base, '29/02/2027').kind).toBe('reask');
  });

  it('refuse un texte vide ou trop long', () => {
    expect(advanceForm(start(), '   ').kind).toBe('reask');
    expect(advanceForm(start(), 'x'.repeat(501)).kind).toBe('reask');
    expect(advanceForm(start(), 'x'.repeat(500)).kind).toBe('next');
  });

  it('n’altère pas la session reçue', () => {
    const session = start();
    const copy = structuredClone(session);
    advanceForm(session, 'Awa');
    expect(session).toEqual(copy);
  });
});
