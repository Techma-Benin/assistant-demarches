/** Documentation overlay only: the shared wire contracts remain unchanged. */
export const traceExample = "00-12345678901234567890123456789012-1234567890123456-01";
const suffix = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
export const examples: Record<string, any> = {
  ConversationInput: { locale: "fr" },
  MessageInput: { id: `msg_${suffix}`, content: { type: "text", text: "Quels documents faut-il pour cette démarche ?" }, sentAt: "2026-10-26T12:00:00.000Z" },
  AttachInput: { guestToken: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.guest" },
  ConsentInput: { challengeId: `chl_${suffix}`, accepted: true },
  NpiChallengeInput: { npi: "1234567890" },
  NpiVerifyInput: { challengeToken: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.challenge", code: "123456" },
};

type Help = { summary: string; tag: string; before: string; action: string; expected: string; next: string; errors: string };
const help = (summary: string, tag: string, before: string, action: string, expected: string, next: string, errors: string): Help => ({ summary, tag, before, action, expected, next, errors });
const user = "JWT usager du portail (Authorize), même usager pour toute la séquence. Un jeton admin est refusé sur ce parcours.";
const owner = user + " Utiliser une conversation créée par cet usager ; remplacer les identifiants fictifs par les valeurs reçues.";
export const operationHelp: Record<string, Help> = {
  getHome: help("Page d’accueil catalogue", "Conversations", "Jeton invité ou usager. X-Road configuré.", "GET /v1/home. Pas de corps.", "200 : procédures et administrations affichables.", "Créer une conversation ou une session invitée.", "401 : jeton ; 503 : X-Road."),
  createGuestSession: help("Créer une session invitée", "Conversations", "Aucune authentification. Signature Backend configurée.", "POST /v1/guest-sessions.", "201 : token et expiresAt.", "Créer une conversation avec ce jeton, puis attach après connexion.", "429 : trop de sessions ; 503 : signature absente."),
  createNpiChallenge: help("Connexion par NPI, étape 1 (simulée)", "Conversations", "Aucune authentification. Disponible seulement si NPI_SIMULATED_LOGIN=on.", "POST /v1/identity/npi avec npi (chiffres seulement).", "201 : challengeToken (5 minutes), expiresAt, simulated.", "Appeler verifyNpiChallenge avec le défi et le code.", "404 : connexion simulée désactivée ; 429 : trop de tentatives ; 400 : NPI non numérique."),
  verifyNpiChallenge: help("Connexion par NPI, étape 2 (simulée)", "Conversations", "Défi obtenu par createNpiChallenge, non expiré. Disponible seulement si NPI_SIMULATED_LOGIN=on.", "POST /v1/identity/npi/verify avec challengeToken et code (chiffres seulement). En simulation, tout code passe.", "200 : token usager connecté (12 heures), expiresAt, simulated.", "Utiliser token comme Bearer ; attach pour reprendre une conversation invitée.", "401 : défi expiré ou invalide ; 404 : connexion simulée désactivée ; 400 : code non numérique."),
  listConversations: help("Lister ses conversations", "Conversations", owner, "GET paginé cursor/limit.", "200 : ConversationPage.", "Ouvrir une conversation existante ou en créer une.", "401/403 : identité."),
  attachConversation: help("Rattacher une session invitée", "Conversations", "JWT Keycloak citizen. Jeton invité encore valide, usage unique.", "POST …/attach avec guestToken. Connexion obligatoire.", "200 : Conversation désormais authentifiée.", "Rejouer le même attach est idempotent ; un autre rattachement du même invité est 409.", "401 : invité ; 409 : déjà rattaché ; 400 : jeton non invité."),
  listEvents: help("3. Lire les événements et la réponse", "Conversations", owner, "Premier appel : laisser cursor vide (max 64 caractères). Les appels suivants reprennent nextCursor.", "200 : items et nextCursor. Chercher bj.techma.message.received.v2 puis bj.techma.message.sent.v2.", "Poursuivre avec nextCursor ou demander un ticket WebSocket.", "410 : curseur expiré ; 400 : curseur trop long."),
  listMyCases: help("Lister ses dossiers X-Road", "Dossiers", owner + " X-Road configuré.", "GET /v1/cases.", "200 : CasePage.", "Ouvrir getMyCase.", "503 : X-Road."),
  getMyCase: help("Lire un dossier X-Road", "Dossiers", owner, "GET /v1/cases/{caseId}.", "200 : Case.", "Télécharger un document délivré si présent.", "404 : dossier absent."),
  downloadMyCaseDocument: help("Télécharger un document de dossier", "Dossiers", owner, "GET binaire /v1/cases/{caseId}/documents/{documentId}.", "200 : octets.", "Conserver le dossier.", "404 : document absent."),
  createConversation: help("1. Créer une conversation", "Conversations", user, "locale fr. Canal pris sur l’identité (web, WhatsApp ou invité). Fournir traceparent et une nouvelle Idempotency-Key.", "201 : objet Conversation. Copier son id ; userRef est attribué par le Backend.", "Utiliser id dans sendMessage, puis listEvents.", "400 : corps/en-tête invalide ; 401 : JWT ; 403 : identité."),
  sendMessage: help("2. Envoyer un message à l’agent", "Conversations", owner, "Renseigner conversationId, puis le corps exemple. Changer id (msg_ + 26 caractères ULID) et Idempotency-Key pour un nouveau message. sentAt est une date ISO.", "202 avec status accepted : message enregistré et mis en attente. Ce n’est pas encore la réponse IA.", "Lire listEvents. La réponse nécessite worker, Redis, modèle actif et outils configurés.", "400 : format ; 403/404 : propriétaire ou conversation ; 409 : rejeu différent."),
  createSocketTicket: help("Obtenir un ticket de connexion WebSocket", "Temps réel", owner, "Fournir une nouvelle Idempotency-Key. Ce POST crée seulement un ticket ; Swagger ne se connecte pas au WebSocket.", "201 : ticket, expiresAt et url. Ticket court, à usage unique ; ne pas le partager.", "Dans un client WebSocket, ouvrir directement url, qui contient déjà ticket ; ajouter éventuellement &cursor=<nextCursor> en encodant la valeur.", "401 à la connexion : ticket expiré/utilisé ou Origin non autorisée ; 410 en relecture HTTP : curseur expiré."),
  grantMandate: help("1. Enregistrer un accord explicite", "Consentement", owner + " Usager connecté (non invité). Challenge créé par le Backend sur MANDATE_MISSING, non expiré. Contrôle Tooling opérationnel.", "Remplacer challengeId par le id du challenge reçu dans le bloc consent. accepted doit être true. Connexion Keycloak citizen obligatoire.", "201 : MandateGrant. Le Tooling reste l’autorité sur le mandat ; conserver son identifiant pour une révocation.", "Continuer le parcours agent. Pour retirer l’accord, appeler revokeMandate.", "401 : invité ; 403 : challenge incompatible/expiré/consommé ; 503 : contrôle Tooling ou signature indisponible."),
  revokeMandate: help("3. Retirer une autorisation", "Consentement", owner + " Mandat réel de cette conversation, contrôle Tooling disponible.", "Renseigner conversationId et mandateId retournés lors de l’accord, puis une nouvelle Idempotency-Key. Pas de corps JSON.", "200 : résultat de révocation.", "Consulter les événements.", "403/404 : mauvais propriétaire ou mandat ; 503 : contrôle Tooling indisponible."),
  uploadFile: help("Déposer une pièce jointe", "Fichiers", user + " Stockage configuré.", "Choisir un fichier de 10 Mio maximum. Corps binaire application/octet-stream. X-File-Mime-Type parmi les valeurs proposées. Nouvelle clé d’idempotence.", "201 : File, son identifiant et sa date d’expiration.", "Envoyer un MessageInput avec content {type: file, fileId: <id reçu>}.", "413 : plus de 10 Mio ; 415 : mauvais type/MIME déclaré ; 503 : stockage indisponible."),
};

const intro = `**Avant le premier essai :** Swagger envoie de vraies requêtes, y compris les modifications. [Lire le guide complet et les cinq scénarios](/docs/guide).

1. Cliquer **Authorize** et saisir un **access token JWT valide**, puis **Try it out → Execute** dans la route choisie. Une valeur d’exemple n’est pas une ressource créée.
2. **Identité :** le JWT doit provenir du portail/fournisseur configuré par OIDC_ISSUER et OIDC_JWKS_URL, audience techma-backend. L’API n’émet pas de jetons ; mock-user et mock-admin ne sont pas acceptés. Sans fournisseur d’identité et jeton, les tests authentifiés restent bloqués.
3. **En-têtes :** traceparent est prérempli pour un essai ; Idempotency-Key doit changer pour chaque nouvelle opération (garder la même clé et le même corps pour un rejeu).
4. **En local :** pnpm dev lance l’API et ses migrations. Il ne lance ni Redis, ni le worker, ni Keycloak, ni le Tooling. Une réponse IA exige aussi un modèle actif et configuré. [Vérifier uniquement l’API et la base](/health).

**Erreurs fréquentes :** 400 = données/en-têtes invalides ; 401 = jeton ; 403 = droits/propriétaire ; 404 = ressource réelle manquante ; 409 = conflit de rejeu ; 410 = curseur expiré ; 413/415 = fichier ; 503 = dépendance/configuration. Lire detail dans Server response. Authorize ne valide pas à lui seul le jeton.`;
const flow: Record<string, string> = {
  conversation: "**Parcours :** createGuestSession ou JWT citizen → createConversation (201) → sendMessage (202) → listEvents (200). Mandats : connexion obligatoire. Attach : usage unique du jeton invité.",
};
const parameterDescriptions: Record<string, string> = {
  traceparent: "En-tête technique de traçage W3C requis. Exemple fourni pour un essai ; générer une nouvelle trace pour un essai distinct. Ne pas y mettre de données personnelles.",
  "Idempotency-Key": "8–128 caractères. Nouvelle clé pour une nouvelle opération ; même clé + même corps pour réessayer sans doublon. Changer le corps avec la même clé peut produire 409.",
  conversationId: "Copier id retourné par createConversation, avec le même JWT usager. L’exemple est fictif et ne crée aucune conversation.",
  mandateId: "Identifiant réel du mandat retourné par grantMandate, dans cette conversation.",
  fileId: "Identifiant réel retourné par uploadFile ; respecter le propriétaire et l’expiration.",
  caseId: "Identifiant de dossier X-Road (cas_…).",
  documentId: "Identifiant de document délivré (doc_…).",
  cursor: "Facultatif au premier appel : laisser vide (64 caractères maximum). Ensuite recopier nextCursor de la dernière page, sans le modifier.",
  limit: "Nombre d’éléments par page : 1 à 100, 20 par défaut.",
  "X-File-Mime-Type": "MIME d’origine du fichier, choisi dans l’enum. Le corps HTTP reste application/octet-stream, pas multipart/form-data.",
};
const parameterExamples: Record<string, unknown> = {
  traceparent: traceExample,
  conversationId: `cnv_${suffix}`,
  mandateId: `mdt_${suffix}`,
  fileId: `fil_${suffix}`,
  caseId: `cas_${suffix}`,
  documentId: `doc_${suffix}`,
  limit: 20,
  "X-File-Mime-Type": "application/pdf",
};

export function describeSpecification(name: string, specification: any) {
  const spec = structuredClone(specification);
  spec.servers = [{ url: "/", description: "Backend courant (les essais peuvent modifier la base)" }];
  spec.info.description = `${flow[name] ?? ""}\n\n${intro}`;
  spec.components.securitySchemes.bearerAuth.description = "Coller uniquement l’access token JWT signé par le fournisseur configuré. Swagger ajoute Bearer. Le rôle dépend du contrat : usager, admin ou service Tooling ; aucun token universel n’est livré. Voir le guide /docs/guide.";
  const tags = new Set<string>();
  for (const methods of Object.values(spec.paths) as any[]) for (const [method, operation] of Object.entries(methods) as [string, any][]) {
    if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
    const h = operationHelp[operation.operationId];
    if (!h) throw new Error(`Missing endpoint documentation: ${operation.operationId}`);
    tags.add(h.tag);
    operation.tags = [h.tag];
    operation.summary = h.summary;
    operation.description = `**Prérequis**\n\n${h.before}\n\n**Comment tester**\n\n${h.action}\n\n**Résultat attendu**\n\n${h.expected}\n\n**Suite du parcours**\n\n${h.next}\n\n**Erreurs à vérifier**\n\n${h.errors}`;
    for (const p of operation.parameters ?? []) {
      p.description = parameterDescriptions[p.name] ?? p.description;
      if (p.name === "Idempotency-Key") p.example = `manual-${operation.operationId}-001`;
      else if (parameterExamples[p.name] !== undefined) p.example = parameterExamples[p.name];
    }
    for (const media of Object.values(operation.requestBody?.content ?? {}) as any[]) {
      const schemaName = media.schema?.$ref?.split("/").at(-1);
      if (examples[schemaName]) media.example = examples[schemaName];
    }
    for (const [code, response] of Object.entries(operation.responses) as [string, any][]) {
      response.description = code === "default" ? "Erreur au format Problem : lire status, code, detail et traceId. Voir les erreurs expliquées dans cette route et dans le guide." : h.expected;
    }
  }
  const fields: Record<string, Record<string, string>> = {
    ConversationInput: { locale: "Langue demandée : fr pour le premier essai." },
    MessageInput: { id: "Identifiant client unique : msg_ + 26 caractères ULID. Nouveau pour chaque nouveau message, stable pour un rejeu.", content: "Texte, référence de fichier privé non expiré ou interaction : choisir une variante du schéma.", sentAt: "Date ISO 8601 avec fuseau, par exemple 2026-10-26T12:00:00.000Z." },
    AttachInput: { guestToken: "Jeton invité encore valide, à usage unique." },
    ConsentInput: { challengeId: "id du challenge reçu et encore valide.", accepted: "true seulement après accord explicite au consentText présenté." },
  };
  for (const [schemaName, properties] of Object.entries(fields)) for (const [property, description] of Object.entries(properties)) {
    const field = spec.components.schemas[schemaName]?.properties?.[property];
    if (field) field.description = description;
  }
  spec.tags = [...tags].map(name => ({ name }));
  return spec;
}
