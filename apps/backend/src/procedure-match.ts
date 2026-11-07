/** Words that say what the citizen wants to do rather than which procedure; mirrors the X-Road simulator search. */
const STOP_WORDS = new Set(
  ('au aux avec ce ces comment dans de des du elle en est et faire il je la le les leur ma mes moi mon nos notre ou par pour quel quelle ' +
    'quels quelles qui quoi sa ses son sur ta tes ton une un vos votre obtenir avoir demande demander besoin veux voudrais peux puis doit ' +
    'dois faut comme cette mais plus tout tous etre suis sont')
    .split(' '),
);

/** Stems of the words that name the kind of paper or the action, not which procedure: "certificat" fits a CIP as well as a nationality certificate. */
const GENERIC = new Set('certif acte delivr extrai attest copie carte docume papier dossie depose demarc proced ligne servic formul fais'.split(' '));

/** Lowercase, no accents, no stop words, cut to a 6-letter stem ("renouveler" and "renouvellement" meet). */
export function requestTerms(text: string): string[] {
  return text
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .map((word) => word.slice(0, 6));
}

/** Whether a sheet title names what the citizen asked: the Backend files only on that, never on a neighbour the model cited. A question with nothing specific left (a follow-up) does not block. */
export function designates(title: string, question: string): boolean {
  const wanted = requestTerms(question).filter((term) => !GENERIC.has(term));
  if (!wanted.length) return true;
  const named = new Set(requestTerms(title));
  return wanted.some((term) => named.has(term));
}
