# Contrat d'intégration v2.2.0

Ce document et les fichiers de `contracts/v2/` sont la seule référence entre les équipes. Ils découlent de la [spécification fonctionnelle](docs/spec.md). Tout ce qui n'y figure pas n'existe pas.

## 1. Principes

1. **Rien en dur.** Une interface n'affiche que ce qu'une API lui donne. Pas de jeton, session, réponse, chiffre ou liste codés dans le front.
2. **Réel ou simulé, jamais faux.** Le catalogue vient de service-public.bj. Dépôt, paiement, décision et document délivré passent par le X-Road simulé et portent `simulated: true` et une référence `SIM-…`, affichés comme tels.
3. **Une seule source par donnée** (§3). Aucune copie locale qui peut diverger.
4. **Pas de mocks dans l'application.** Les tests unitaires peuvent simuler une dépendance ; la démo et les tests d'intégration tournent sur les vrais services.
5. **Une fonctionnalité listée marche de bout en bout**, sinon elle est retirée du contrat.
6. **Confidentialité.** Le modèle ne lit jamais le contenu d'une pièce. La console ne montre jamais le texte des conversations.

## 2. Services

| Service | Dossier | Port local | Équipe | Rôle |
|---|---|---|---|---|
| Interface | `apps/interface/web` (cible) | 3000 | Interface | Site usager `/`, chat intégrable `/embed`, console `/admin`, écran opérateur `/operateur` |
| Backend | `apps/backend` | 4010 | Backend | Conversations, agent IA, pièces, consentement, API console et opérateur, canal WhatsApp |
| Tooling | `apps/tooling` | 4030 | Tooling | Serveur MCP : brouillons, mandats, dépôt et suivi des dossiers |
| X-Road simulé | `apps/xroad-sim` | 4040 | Tooling | Administrations, catalogue officiel, dossiers, annuaire des agents, indicateurs |
| Keycloak | `infra/keycloak` | 8080 | Commun | Connexion des personnes et identités de service |
| PostgreSQL | lancé par `pnpm dev` | 54329 | Commun | Une instance, une base par service : `backend`, `tooling`, `xroad` |

Pas de Redis, pas de worker séparé, pas de mocks. `pnpm dev` lance tout sans Docker (voir [README](README.md)).

## 3. Qui détient quoi

| Donnée | Source unique | Accès des autres |
|---|---|---|
| Identité, connexion, mots de passe | Keycloak | Jetons OIDC |
| Administrations, agents, rôles, affectations, profils | X-Road simulé | Backend via `xroad.openapi.json` |
| Catalogue des démarches | X-Road simulé (import `content/service-public/catalogue.json`) | Tooling via MCP → Backend |
| Dossiers, statuts, décisions, paiements, documents délivrés, journal | X-Road simulé | Tooling (côté usager), Backend (console et « Mes démarches ») |
| Conversations, messages, pièces de l'usager, consentements présentés, questions sans réponse | Backend | Tooling lit les pièces par `backend-internal` |
| Brouillons (`Request`), mandats, journal des appels d'outils | Tooling | Backend via MCP et événements |
| Modèles d'IA, connexions MCP | Backend | Écran opérateur |

Le Backend ne stocke aucun dossier ni aucun agent. Le Tooling ne stocke aucune décision administrative.

## 4. Identités (Keycloak, realm `techma`)

Realm exporté dans `infra/keycloak/realm-techma.json`, importé au démarrage avec les comptes de démo.

| Qui | Comment | Vérifié par |
|---|---|---|
| Visiteur web non connecté | Jeton invité signé par le Backend (`POST /v1/guest-sessions`, 24 h) | Backend |
| Usager connecté | Keycloak, client `interface`, rôle realm `citizen`, audience `techma-backend` | Backend |
| Usager connecté par NPI (simulé) | NPI puis code (`POST /v1/identity/npi`, `POST /v1/identity/npi/verify`), jeton `npi` signé par le Backend, 12 h, traité comme un usager connecté. Actif seulement avec `NPI_SIMULATED_LOGIN=on`. | Backend |
| Usager WhatsApp | Numéro vérifié par la signature Meta, dans le module WhatsApp du Backend. Compte comme connecté. | Backend |
| Agent, admin, super admin | Keycloak, client `interface`, rôle realm `official`. Rôle et administration lus dans le X-Road simulé par le `sub`. | Backend puis X-Road simulé |
| Opérateur | Keycloak, client `interface`, rôle realm `operator` | Backend |
| Service Backend | Client `backend` (client_credentials), scopes `tools:call`, `mandates:grant`, `xroad:apply`, `xroad:administer`, et gestion des utilisateurs du realm | Tooling, X-Road simulé, Keycloak |
| Service Tooling | Client `tooling` (client_credentials), scopes `events:publish`, `files:read`, `xroad:apply` | Backend, X-Road simulé |

Règles :
- JWT RS256, issuer `http://127.0.0.1:8080/realms/techma` en local, vérifié par JWKS ; audiences `techma-backend`, `techma-tooling`, `techma-xroad`.
- Le Backend publie ses propres clés (jetons invités et preuves de consentement) sur `GET /.well-known/jwks.json`.
- `userRef` (`usr_…`) est attribué par le Backend à partir du `sub` Keycloak ou du numéro WhatsApp. Il n'est jamais accepté depuis le navigateur ni depuis le modèle.
- Le Backend transmet au Tooling `X-User-Ref`, `X-Conversation-Id`, `X-Channel`, `X-Mandate-Id`, et au X-Road `X-Applicant-Ref` (vue usager) ou `X-Official-Subject` (vue agent). Ces en-têtes ne viennent que du code, jamais du modèle.
- Aucun jeton statique, aucun `mock-*`, aucun mode d'authentification de développement dans le code, à une exception nommée : la connexion par NPI simulée. Tout code numérique y est accepté et aucun SMS n'est envoyé ; elle n'existe que si `NPI_SIMULATED_LOGIN=on` (sinon les deux routes répondent 404) et doit être remplacée par la vérification réelle du code. Raison : permettre de livrer et de tester le parcours de connexion avant que le fournisseur de SMS soit branché, sans changer l'écran ni le contrat.

## 5. Contrats machine (`contracts/v2/`)

| Fichier | Producteur → consommateur |
|---|---|
| `domain.schema.json` | Schémas partagés par tous |
| `conversation.openapi.json` | Backend → Interface (site usager, chat intégrable) |
| `admin.openapi.json` | Backend → Interface (console d'administration) |
| `operator.openapi.json` | Backend → Interface (écran opérateur) |
| `mcp.tools.json` | Tooling → Backend (outils MCP) |
| `tooling-internal.openapi.json` | Tooling → Backend (enregistrement des mandats) |
| `backend-internal.openapi.json` | Backend → Tooling (événements, lecture des pièces) |
| `xroad.openapi.json` | X-Road simulé → Tooling et Backend |
| `examples.json` | Exemples réels validés |

Commandes :
- `pnpm contracts:sync` recopie dans chaque contrat les schémas partagés qu'il utilise. On ne modifie que `domain.schema.json` et la partie `paths`/`tools`.
- `pnpm contracts:check` valide tout.
- `pnpm contracts:generate` produit `packages/contracts-ts` : `Schemas` (tous les schémas) et `ConversationPaths`, `AdminPaths`, `OperatorPaths`, `BackendInternalPaths`, `ToolingInternalPaths`, `XroadPaths`. Ne jamais modifier ces fichiers à la main.

## 6. Règles HTTP communes

- JSON en `camelCase` anglais, textes d'interface en français. Objets fermés (`additionalProperties: false`).
- Identifiants `préfixe_` + ULID (26 caractères Crockford), générés par le propriétaire de la donnée. Dates ISO 8601 UTC. Montants en FCFA entiers.
- Erreurs : `application/problem+json`, schéma `Problem`. Codes HTTP : 400 `INVALID_REQUEST` ; 401 `UNAUTHORIZED`, `LOGIN_REQUIRED` ; 403 `FORBIDDEN`, `MANDATE_*` ; 404 `NOT_FOUND` (y compris une ressource hors de portée) ; 409 `CONFLICT`, `INVALID_TRANSITION`, `REQUEST_INCOMPLETE`, `NOT_ASSISTED`, `IDEMPOTENCY_CONFLICT` ; 413/415 fichiers ; 429 `RATE_LIMITED` ; 503 `UPSTREAM_UNAVAILABLE` et `MCP_*` avec `Retry-After`.
- `traceparent` facultatif : le serveur en crée un s'il manque et le propage.
- `Idempotency-Key` obligatoire seulement là où le contrat l'exige : actions MCP, dépôt, paiement, réponse et action sur un dossier X-Road, mandats, action d'un agent dans la console. Même clé + même corps = même réponse pendant 24 h.
- Pagination : `cursor` opaque, `limit` 1–100 (défaut 20), `nextCursor: null` en fin de liste.
- HTTPS obligatoire hors poste local.

## 7. Parcours usager

### 7.1 Conversation

0. L'accueil affiche `GET /v1/home` (sans authentification) : thèmes des administrations connectées et suggestions de démarches réelles.
1. L'Interface obtient un jeton invité (ou utilise la session Keycloak si l'usager est déjà connecté), puis `POST /v1/conversations`.
2. Messages : `POST …/messages` (dédupliqué par `message.id`). Réponse par le flux d'événements : WebSocket via `socket-ticket`, ou `GET …/events` en repli.
3. `GET …/events` sans curseur restitue l'historique des **messages complets** (`message.received` et `message.sent`). `message.received` porte le contenu et la transcription d'un vocal. Le rechargement n'est pas un déluge de jetons : **`message.delta` n'y figure pas**.
4. `message.delta` est une livraison **live uniquement** : trames WebSocket et/ou `GET …/events` **avec curseur** après abonnement. Chaque événement est un Event CloudEvents 1.0 (`type = bj.techma.message.delta.v2`). `data` (objet fermé) : `kind`, `conversationId`, `messageId` (le même que le `message.sent` à venir), `delta` (morceau de texte), `index` facultatif (ordre 0-based). `delta` vide seulement si un signal terminal est indispensable ; le contrat n'exige pas ce delta terminal.
5. Pendant la génération, le Backend **peut** émettre zéro, un ou plusieurs `message.delta`. Ils portent uniquement le texte du futur bloc `text` — jamais les blocs structurés (`buttons`, `form`, `fileRequest`, `loginRequired`, `consent`, `requestCard`, `caseCard`) ni les `sources`.
6. La clôture reste `message.sent` : `AgentMessage` complet, `blocks` définitifs. L'Interface remplace / finalise la bulle en cours par cet événement. Sources, boutons, formulaire, `fileRequest` et les autres blocs n'apparaissent que sur `message.sent`. Le modèle ne produit toujours que `text` / `buttons` / `form` ; les autres blocs restent construits par le Backend.
7. `message.delta` n'est **pas** émis : dans `GET …/events` sans curseur ; après le `message.sent` du même `messageId` ; pour une réponse sans texte (pas de bloc `text` à venir) ; par le Tooling (`POST /internal/v1/events`).
8. Vocal : `POST /v1/files` (audio), puis message `{type: audio, fileId}`. Le Backend transcrit, et la transcription apparaît dans `message.received`.
9. Connexion par NPI : l'Interface appelle `POST /v1/identity/npi` (le NPI ne transite que par cet appel, jamais par la conversation ni par le modèle), puis `POST /v1/identity/npi/verify` avec le défi et le code reçu. Le jeton obtenu s'utilise comme un jeton usager connecté ; un même NPI donne toujours le même `userRef`. Une conversation invitée s'y rattache par `POST …/attach`, et l'action en attente est reprise.
10. Suivi des demandes depuis n'importe quel chat : l'usager connecté demande où en sont ses demandes, y compris dans une nouvelle conversation. L'assistant interroge la liste des dossiers de l'usager et répond par des blocs `caseCard` ; un invité reçoit `loginRequired`, et la question est rejouée après connexion.

### 7.2 Réponses de l'assistant (`AgentMessage.blocks`)

| Bloc | Sens | Ce que fait l'Interface |
|---|---|---|
| `text` | Réponse. Toute information administrative cite au moins une `Source` (fiche service-public.bj). Un texte de conversation (salutation, clarification) peut avoir `sources: []`, en phrases naturelles. | Affiche le texte et ses sources cliquables |
| `buttons` | Choix rapides | Envoie `{type: interaction, actionId}` |
| `form` | Questions groupées | Envoie les réponses en `interaction` |
| `fileRequest` | Pièce attendue pour un brouillon | Bouton d'ajout sur la ligne. Upload `POST /v1/files`, puis message `{type: file, fileId, documentType}` |
| `loginRequired` | L'action demande une connexion | Lance la connexion Keycloak, puis `POST …/attach` avec le jeton invité |
| `consent` | Consentement préparé par le Backend (texte serveur) | Affiche `consentText` tel quel ; le clic appelle `POST …/mandates` |
| `requestCard` | État du brouillon | Met à jour le panneau « vos informations » (champs avec provenance, pièces, manques) |
| `caseCard` | État d'un dossier déposé | Affiche statut, référence SIM, paiement, complément demandé, documents délivrés |

Le modèle ne produit que `text`, `buttons` et `form`. Les blocs `fileRequest`, `loginRequired`, `consent`, `requestCard` et `caseCard` sont construits par le code du Backend à partir des résultats d'outils et des événements, jamais inventés par le modèle. Un `message.delta` n'ajoute jamais un bloc : il n'apporte que du texte pour le futur bloc `text` (§7.1).

### 7.3 Démarche déposable

1. `procedures.search` / `procedures.get` : la fiche indique `filing` (déposable) ou `null` (information et lien officiel seulement).
2. `request.create` exige un usager connecté. Avec un jeton invité, le Backend renvoie un bloc `loginRequired`. Après `attach`, la conversation continue au même endroit.
3. Une action sans mandat actif renvoie `MANDATE_MISSING`. Un mandat périmé (1 h) renvoie `MANDATE_EXPIRED` : le Backend le traite comme `MANDATE_MISSING` (nouveau challenge, bloc `consent`, reprise après accord). Le clic de l'usager accorde le mandat, et l'action est rejouée.
4. `request.update` et `documents.attach` remplissent le brouillon ; chaque résultat produit un `requestCard`.
5. `request.submit` : le Tooling lit les pièces (`backend-internal`), les transmet au X-Road (`/v1/uploads`) et dépose le dossier (`POST /v1/cases`). Il renvoie un `caseCard`.
6. `request.pay` si `status = awaiting_payment`.
7. Le Tooling suit les dossiers déposés et publie `case.updated` à chaque changement. Le Backend en fait un `caseCard` dans la conversation et une notification WhatsApp.
8. Complément : `information_requested` arrive par `case.updated` avec `informationRequest.note`. L'assistant le présente ; la réponse de l'usager part par `case.respond`.
9. Documents délivrés : `Case.documents` (`kind: issued`), téléchargés par `GET /v1/cases/{caseId}/documents/{documentId}`.

### 7.4 Brouillon (Tooling)

`draft` → `ready` (plus rien dans `missing`) → `submitted` (avec `caseId`), ou `cancelled`. Après `submitted`, le brouillon n'est plus modifiable ; l'état fait foi dans le dossier X-Road.

## 8. Dossier (X-Road simulé)

```text
POST /v1/cases ─┬─ frais > 0 → awaiting_payment ─ paiement ─┐
                └─ sans frais ──────────────────────────────┴→ received
received ─ règle de la démarche ─┬→ completed (completedBy: assistant, document délivré)
                                 └→ in_review (étape bloquée : vérification par un agent)
in_review ─ claim ─→ in_review (claimedBy)
in_review ─ request_information ─→ information_requested ─ réponse de l'usager ─→ in_review
in_review ─ approve ─→ completed (completedBy: administration, document délivré)
in_review | information_requested ─ reject ─→ rejected
```

- Démarches déposables : PS00373 casier judiciaire (Justice, vérifié par un agent), PS00393 acte de naissance sécurisé (ANIP, complété par l'assistant), PS00392 certificat d'identification personnelle (ANIP, complété par l'assistant), PS00254 authentification de diplôme (Enseignement, complété par l'assistant). Leurs champs, pièces et frais suivent la fiche officielle et sont vérifiés par test.
- Console : **En attente** = `received`, `in_review`, `information_requested` ; **Complété** = `completed` ; **Rejeté** = `rejected`.
- `steps` décrit ce que l'assistant a fait et ce qui demande une intervention ; c'est ce que la console affiche.
- Toute transition produit une entrée de journal (`ActivityEntry`).

## 9. Console d'administration

- Le Backend vérifie le jeton Keycloak (rôle `official`), puis appelle le X-Road avec `X-Official-Subject`. Le X-Road applique le cloisonnement : un agent ne voit que son administration, et un dossier d'une autre administration répond 404.
- `GET /v1/admin/me` donne le profil, l'administration et les permissions. L'Interface masque ce qui n'est pas permis ; le serveur refuse quand même.
- Un super admin choisit l'administration (`administrationId`) et voit les administrations non connectées comme telles.
- `POST /v1/admin/officials` : le Backend crée le compte Keycloak (mot de passe temporaire à changer) puis inscrit le `sub` dans le X-Road.
- Questions sans réponse : le Backend enregistre le thème et le motif, jamais le texte de la question.
- Aucun texte de conversation, aucun modèle, aucun MCP dans la console.

## 10. Écran opérateur

- Rôle `operator` uniquement. Configuration globale.
- Modèles : `baseUrl` compatible OpenAI, `protocol`, `model`, `apiKeyRef` (nom de la variable d'environnement), `temperature`, un seul `active`. L'agent utilise le modèle actif sans redémarrage.
- Connexions MCP : URL autorisée par `MCP_ALLOWED_URLS` ; découverte réelle (`tools/list`) ; outils désactivés et avec consentement par défaut ; une définition changée est désactivée à la redécouverte. Le serveur Techma (Tooling) est provisionné au démarrage.

## 11. MCP (Tooling)

- Transport Streamable HTTP, `POST /mcp`, SDK officiel. Pas de route REST d'outils.
- `initialize` et `tools/list` sont permis sans contexte. `tools/call` exige `X-Conversation-Id` et `X-User-Ref` ; les actions exigent aussi `X-Mandate-Id` et `Idempotency-Key` ; `request.submit` exige `X-Channel`.
- Résultat : `structuredContent` conforme à `outputSchema` et le même JSON en bloc texte. Erreur métier : `isError: true` et `{code, detail, traceId}`.
- `_meta.bj.techma/requiresMandate` et `bj.techma/requiresLogin` décrivent la règle ; le Tooling la vérifie lui-même.

## 12. Événements Tooling → Backend

CloudEvents 1.0 en JSON (`Event`), `type = bj.techma.{kind}.v2`, `POST /internal/v1/events`, 202 après persistance, rejeu sans effet sur un même `id`.

| `kind` | Émis quand | Effet côté Backend |
|---|---|---|
| `case.updated` | Le suivi voit un changement de dossier | `caseCard` dans la conversation, notification WhatsApp |
| `tool.called` | Chaque appel d'outil | Journal technique (opérateur), jamais affiché à l'usager |
| `mandate.granted`, `mandate.revoked` | Mandat créé ou retiré | Mise à jour de l'état de consentement |

Le flux de conversation vers l'Interface contient `message.received`, `message.delta` et `message.sent`. `message.delta` est live uniquement (§7.1) ; `message.sent` reste la source de vérité de la réponse.

## 13. Pièces et documents

- Pièces usager : `POST /v1/files`, PDF/JPEG/PNG (et audio pour les vocaux), 10 Mio. Conservées 24 h si elles ne sont rattachées à aucun dossier. Pas d'analyse du contenu, pas d'antivirus.
- Au dépôt, le Tooling transmet les pièces au X-Road, qui les conserve avec le dossier.
- Documents délivrés : PDF générés par le X-Road, marqués « SIMULATION ».

## 14. Faire évoluer le contrat

1. Une équipe qui bute sur le contrat ouvre une PR qui modifie `contracts/v2/` **et** ce document, avec la raison.
2. La version du manifeste et des `info.version` augmente : mineure pour un ajout compatible, majeure sinon. La CI le vérifie.
3. La PR est relue par les trois équipes avant fusion dans `dev`. Pas de changement de frontière sans cette PR.
4. Les implémentations suivent dans des PR séparées, une fois le contrat fusionné.
