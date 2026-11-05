# Tâches par équipe

Base : `dev` après le nettoyage du 1er novembre 2026. Le contrat v2 est en place, l'infrastructure se lance avec `pnpm dev:infra`, le code contradictoire est supprimé. Le code restant de chaque application est le point de départ de sa migration vers v2 : il ne respecte pas encore le contrat. Chaque équipe commence par cette migration.

Une tâche est terminée quand elle marche de bout en bout avec `pnpm dev`, sans donnée en dur, avec ses tests. Les numéros (U, W, A, O, X) renvoient à la [spécification](spec.md).

## Ordre conseillé

1. **Jour 1** : chaque équipe migre son application vers v2 et la fait démarrer dans `pnpm dev` (variables de `scripts/dev/local-config.mjs`).
2. **Jour 2** : parcours de dépôt complet (sections 7 et 8 du contrat).
3. **Jour 3** : console, opérateur, WhatsApp, design.
4. **Jour 4** : test de bout en bout du parcours de démonstration, corrections.

## Backend (`apps/backend`)

État : environ 60 erreurs de typage contre v2 (`pnpm --filter @techma/backend typecheck`). Le contrôleur de configuration utilise encore l'ancien annuaire supprimé.

1. **Migration v2.**
   - Type interne de conversation avec `userRef` (le schéma public `Conversation` ne l'expose plus).
   - `message.received` porte le contenu du message et la transcription d'un vocal.
   - Supprimer les événements `request.*` et ingérer `case.updated` en bloc `caseCard`.
   - Consentement : sur `MANDATE_MISSING`, le Backend crée le challenge et envoie un bloc `consent`. La route `mandate-challenges` disparaît.
   - `ModelConfig` v2 : `baseUrl`, `protocol`, `apiKeyRef`. Supprimer `MODEL_PROVIDERS_JSON`.
   - `Procedure.filing` remplace `requiredDocuments`, `formSchema` et `validationStatus`.
2. **Identités.**
   - Vérifier les jetons Keycloak avec `OIDC_ISSUER` (JWKS du realm).
   - Jetons invités signés avec `SIGNING_KEY_FILE`, `POST /v1/guest-sessions`, `GET /.well-known/jwks.json`.
   - `POST …/attach`, et `userRef` dérivé du `sub` Keycloak.
   - Jeton de service `backend` (client_credentials) vers le Tooling et le X-Road.
   - Supprimer `DEFAULT_ADMINISTRATION_ID`, les jetons statiques et les boutons de test de Swagger.
3. **Traitement des messages dans le processus de l'API** : boucle sur `backend_messages` avec `FOR UPDATE SKIP LOCKED`, plus la maintenance. Retirer la dépendance `bullmq`.
4. **Agent.** Phrases naturelles : supprimer la liste fermée `SAFE_CONVERSATIONAL_TEXT` ; seules les informations administratives exigent une source vérifiée. Le modèle ne produit que `text`, `buttons` et `form`. Le code construit `fileRequest`, `loginRequired`, `consent`, `requestCard` et `caseCard` (U2, U5–U13). Enregistrer les questions sans réponse avec thème et motif (A7).
5. **Vocal** : transcription (Groq `whisper-large-v3-turbo` ou OpenAI `whisper-1`, selon `MODEL_PROVIDER`) dès qu'une clé API compatible est présente (pas de `TRANSCRIPTION_ENABLED` ; décision produit de l'utilisateur Billux), avec la transcription dans `message.received` (U3).
6. **Accueil** : `GET /v1/home` depuis le X-Road (U1).
7. **« Mes démarches »** : `GET /v1/cases…` via le X-Road avec `X-Applicant-Ref` (U12, U14).
8. **Console** : toutes les routes de `admin.openapi.json`, appelées vers le X-Road avec `X-Official-Subject` (A1–A12). Pour `createOfficial`, créer le compte via l'API d'administration Keycloak (le compte de service `backend` a `manage-users`). Photo : stockage privé et `avatarUrl`.
9. **Opérateur** : `/v1/operator/*`, rôle `operator`, configuration globale ; serveur MCP Techma provisionné au démarrage (O1–O3).
10. **WhatsApp**, avec l'équipe Interface : module `src/channels/whatsapp` (webhook Meta, signature, rendu des blocs, notifications `case.updated`). Il remplace `apps/interface/whatsapp-adapter` et son contrat de rappel (W1–W3).
11. **Démarrage** : script `dev` lancé par `pnpm dev`, migrations appliquées au démarrage, variables de `local-config.mjs`.

## Tooling (`apps/tooling`)

État : compile. À l'exécution, il lit encore les schémas v1 (`src/contracts.ts`).

1. **Migration v2.**
   - Charger `contracts/v2`.
   - 9 outils : `case.status` et `case.respond` sont ajoutés, `documents.verify` disparaît.
   - `Request` v2 : champs avec provenance, pièces, `missing`, `caseId`. États `draft`, `ready`, `submitted`, `cancelled`.
2. **Identités.**
   - Jetons Keycloak : MCP réservé à `azp = backend` avec le scope `tools:call` ; mandats avec `mandates:grant`.
   - Client sortant `tooling`. Preuves de consentement vérifiées via `BACKEND_JWKS_URL`.
   - Supprimer le mode `mock-tokens`. PGlite reste réservé aux tests.
3. **Catalogue uniquement via le X-Road.** Supprimer `PROCEDURES_SOURCE=backend`, le connecteur `simulated` et l'option `CONNECTORS`.
4. **Dépôt.**
   - `request.submit` : lire les pièces (`backend-internal`), les envoyer à `POST /v1/uploads` du X-Road, puis `POST /v1/cases` avec `X-Channel`.
   - `request.pay`, `case.status` et `case.respond` (U10, U11, U13).
5. **Suivi** : interroger les dossiers déposés et publier `case.updated` vers le Backend via l'outbox (U12).
6. **Démarrage** : script `dev` lancé par `pnpm dev`, base `tooling`.

## X-Road simulé (`apps/xroad-sim`, équipe Tooling)

État : compile. À l'exécution, il lit encore les schémas v1.

1. **Migration v2.**
   - `Case` v2 : documents `submitted`/`issued`, `informationRequest`, `claimedBy`, `channel`, `title`.
   - État `information_requested`.
   - `Procedure.filing` pour les 4 démarches déposables.
2. **Annuaire** : `Official.subject` = identifiants Keycloak du realm de démo (`7f3c2a10-…`, voir `infra/keycloak/realm-techma.json`). Routes `officials/me` (par `X-Official-Subject`), inscription, mise à jour et profil (X7).
3. **Actions et journal** : `claim`, `request_information`, `approve`, `reject`, réponses de l'usager, `uploads`, `GET /v1/activity`, indicateurs avec période et `byChannel` (X3–X8).
4. **Stockage PostgreSQL** (`DATABASE_URL`), à la place du fichier d'état.
5. **Identités** : jetons Keycloak (audience `techma-xroad`, `azp` `tooling` ou `backend`, scopes `xroad:apply`, `xroad:administer`). Supprimer les jetons `mock-*`.
6. **Démarrage** : script `dev` lancé par `pnpm dev` ; catalogue lu depuis `CATALOGUE_FILE`.

## Interface (`apps/interface`)

État : environ 70 erreurs de typage dans le widget et 70 dans la console contre v2. Les sessions de démo et les écrans opérateur de la console sont à retirer.

1. **Une seule application** `apps/interface/web` (paquet `@techma/interface`, script `dev`, `PORT=3000`).
   - Y fusionner le widget (`/`, `/embed`) et la console (`/admin`), et créer `/operateur`.
   - Supprimer `web-widget` et `admin-console`.
   - Retirer `src/server/session.ts` (sessions de démo) et les pages modèles, outils, fiches et conversations de la console.
2. **Connexion.**
   - Keycloak, code d'autorisation + PKCE, côté serveur Next (client `interface`, `SESSION_SECRET_FILE`).
   - Jeton invité pour un visiteur ; `attach` après connexion (U8).
   - Aucun jeton dans le navigateur.
3. **Site usager.**
   - Accueil depuis `GET /v1/home`, sans thèmes, suggestions ni compteurs en dur (U1).
   - Blocs v2 : `loginRequired`, `consent` (supprimer la création de challenge côté widget), `requestCard` (panneau « vos informations »), `caseCard`.
   - Historique complet au rechargement, vocal, pièces par ligne, « Mes démarches », chat intégrable, mobile (U1–U16).
4. **Console** : toutes les vues de `admin.openapi.json` (A1–A12). Le changement de compte se fait par reconnexion.
5. **Opérateur** : `operator.openapi.json` (O1–O3).
6. **Design** niveau Airbnb, maquettes du lead (« Bonjour, Bénin »).
7. **WhatsApp**, avec le Backend : déplacer le rendu et l'intégration Meta de `whatsapp-adapter` dans le module WhatsApp du Backend, puis supprimer le dossier (W1–W3).

## Commun

- **Test de bout en bout** du parcours de démonstration (spec §4) sur la vraie pile. Il devient le critère d'acceptation du 5 novembre.
- `pnpm check` vert sur `dev`. Pendant la migration, chaque équipe garde sa propre application verte.
