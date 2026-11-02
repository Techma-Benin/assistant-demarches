# @techma/interface

Interface unique (Next.js 16, React 19, Tailwind v4) : site public, conversation et console d'administration.

| Route | Contenu |
| --- | --- |
| `/` | site (page d'accueil) |
| `/conversation` | conversation pleine page (contrat v2) |
| `/demarches` | « Mes démarches » : dossiers déposés (`GET /v1/cases`) ; `/demarches/{caseId}` : un dossier |
| `/embed` | chat intégrable, voir « Chat intégrable » |
| `/admin` | console d'administration (vue d'ensemble, à vérifier, complété, sans réponse, journal, utilisateurs, profil) |

## Lancer en local

Démarrée par le `pnpm dev` de la racine (variable `PORT`, 3000 par défaut). Seule : `cp .env.example .env.local`, puis `npx next dev` ici. Autres commandes : `pnpm test | typecheck | build` dans ce dossier.

Le chat usager suit le contrat v2 (`CONTRACTS.md`, `contracts/v2/`). À faire : migration de la console et de l’écran opérateur. `src/components/operator` et `src/lib/operator` conservent du code de configuration (modèles, outils MCP) non monté pour l'écran opérateur futur.

## Console d'administration

- Pages sous `src/app/admin`, composants sous `src/components/admin`, logique sous `src/lib/admin`.
- Le navigateur n'a jamais de jeton : les appels passent par `/api/admin/[...path]` (`src/server/admin-proxy.ts`, liste blanche stricte) ; le ministère choisi par un super admin est posé en cookie par `/api/admin-department`.

## Authentification

- Serveur uniquement (Keycloak, realm `techma`, client confidentiel `interface`, PKCE S256, `openid-client`) : aucun jeton n'atteint le navigateur. Variables : voir `.env.example` (injectées par `pnpm dev`).
- Session : cookie chiffré `ad_session` (jose, A256GCM, clé dans `SESSION_SECRET_FILE`), HttpOnly, SameSite=Lax, découpé en `ad_session.0`, `.1`… au-delà de 3800 octets. Transaction de connexion : cookie `ad_auth` (10 min).
- Routes : `GET /auth/login?returnTo=&conversationId=`, `GET /auth/callback`, `POST /auth/logout` (même origine), `GET /api/session` (`{user}` sans jeton).
- Visiteur : jeton invité créé côté serveur (`POST /v1/guest-sessions`) ; à la connexion, `attach` transfère ses conversations au compte.
- `/api/admin/*` exige le rôle `official` (401 / 403) ; la console `/admin` redirige vers la connexion, ou affiche un écran d'accès refusé sans ce rôle. Un lien profond vers `/admin/...` atterrit sur `/admin` après connexion.

## Architecture

- Le navigateur n'a jamais de jeton : tout appel au Backend passe par `/api/backend/[...path]` (route Next) qui délègue à `src/server/backend-proxy.ts`.
- Le proxy applique une liste blanche (méthode + chemin), ne relaie que quelques en-têtes et injecte `Authorization` : jeton usager, sinon jeton invité (`src/server/auth/tokens.ts`). `GET /v1/home` part sans `Authorization`.
- `src/lib/c1-client.ts` : client du contrat conversation v2 typé (types générés `@techma/contracts-ts`), `traceparent` neuf à chaque appel, `Idempotency-Key` stable.
- `src/lib/conversation-state.ts` : réducteur pur (déduplication par `Event.id`). Le flux v2 ne porte que `message.received` et `message.sent` ; `message.received` reconstitue les messages de l’usager (et la transcription d’un vocal) au rechargement ; `src/hooks/use-conversation.ts` le relie au flux temps réel (voir « Temps réel »).
- `src/components/blocks/*` : un composant par bloc v2 (`text`, `buttons`, `form`, `fileRequest`, `loginRequired`, `consent`, `requestCard`, `caseCard`), texte brut uniquement, liens http(s) seulement. Le bloc `statusCard` de la v1 n'existe plus.

## Conversation (v2)

- Création paresseuse : la conversation (`POST /v1/conversations`, corps `{locale: 'fr'}`) n'est créée qu'au premier message, fichier ou vocal. L'accueil ne dépend pas du Backend, et un seul appel à la fois évite de créer plusieurs sessions invitées.
- Rechargement : seul l'identifiant de la conversation est gardé dans `sessionStorage` (jamais la chronologie). La chronologie est reconstruite par `GET …/events` sans curseur (historique complet, messages de l'usager et transcriptions compris), puis le flux continue.
- Pendant l'attente, l'activité reste neutre (« L’assistant prépare sa réponse ») : le flux ne porte plus `tool.called`.
- Contenus envoyés : `text` ; `audio {fileId}` ; `file {fileId, documentType}` (`documentType` du bloc `fileRequest` auquel le fichier répond, sinon `null`) ; `interaction {actionId, value}` (`value: null` pour un bouton, JSON des réponses pour un formulaire).
- `loginRequired` : bouton « Se connecter pour continuer » vers `/auth/login?returnTo=<page>&conversationId=<id>` (navigation complète).
- `consent` : le `consentText` du Backend est affiché tel quel. « J’autorise » appelle `POST …/mandates` (`{challengeId, accepted: true}`, `Idempotency-Key: consent-<challengeId>`). « Refuser » reste local : le contrat n'accepte que `accepted: true`.
- `requestCard` : met à jour le panneau « Vos informations » (champs avec provenance, pièces, manques). `caseCard` : statut, référence `SIM-…` avec la marque « Simulation », administration, paiement (« simulé »), complément demandé, documents délivrés téléchargeables par `/api/backend/v1/cases/{caseId}/documents/{documentId}`. Aucun bouton de paiement dans le chat.
- « Mes démarches » (`/demarches`) exige une connexion : un visiteur invité (`GET /api/session` sans utilisateur, ou 401/403) voit « Connectez-vous pour voir vos démarches ».

## Chat intégrable

`/embed` affiche la conversation seule (sans en-tête ni pied de page du site), sur toute la hauteur de la fenêtre. Pour l'intégrer à un autre site :

```html
<iframe
  src="https://assistant.example.bj/embed"
  title="Assistant Démarches"
  width="420"
  height="640"
  style="border: 0; max-width: 100%;"
  allow="microphone"
></iframe>
```

- `title` est obligatoire pour l'accessibilité ; `allow="microphone"` active les messages vocaux ; la taille minimale conseillée est 360 × 520.
- La conversation se crée au premier message ; un rechargement de l'iframe la reprend (`sessionStorage` de l'onglet).
- Le logo ouvre le site dans un nouvel onglet. La connexion (`loginRequired`) navigue dans l'iframe : sur un site tiers, les cookies de session doivent être autorisés.

## Design

Le widget utilise la fondation de design « Sceau » du paquet `@techma/ui` (tokens, thème Tailwind, composants) : voir `packages/ui/README.md`. Guide de style vivant (dev uniquement) : `/dev/design`.

## Temps réel

`src/lib/conversation-stream.ts` (`ConversationStream`, indépendant de React) alimente le réducteur ; `useConversation` l'expose via `connection` (`connecting | live | polling | offline`).

- Connexion : `POST …/socket-ticket` (ticket à usage unique, 60 s, nouvelle `Idempotency-Key` à chaque demande) puis WebSocket sur l'`url` reçue (`ws:`/`wss:` uniquement). Le ticket et l'URL ne sont jamais journalisés.
- Reprise : à la reconnexion, le paramètre `cursor=<dernier Event.id>` rejoue les événements manqués, puis le flux continue en direct. Curseur inconnu ou expiré (fermeture 1008 `REPLAY_EXPIRED`) : curseur remis à zéro et reconnexion immédiate.
- Reconnexion : nouveau ticket après 1, 2, 4, 8, 16, puis 30 s (remis à 1 s après une ouverture réussie) ; `Retry-After` respecté sur 429/503.
- Repli : tant que le socket n'est pas ouvert après un échec, polling `GET …/events?cursor=` toutes les secondes (pages de 100 : relance immédiate ; 410 : curseur remis à zéro). Il s'arrête à l'ouverture du socket ; une réponse de polling arrivée après un changement de curseur est ignorée.
- Hors ligne : sans réseau (`navigator.onLine`, événements `online`/`offline`), aucune requête n'est émise ; le retour du réseau relance la connexion aussitôt. Un bandeau (`role="status"`) s'affiche : immédiatement hors ligne, après 3 s de connexion instable sinon.
- Déduplication : livraison au moins une fois, le réducteur dédoublonne par `Event.id` ; l'ordre est garanti par conversation.
- Le heartbeat (ping/pong toutes les 30 s) est géré côté serveur ; le navigateur répond aux pongs, aucun heartbeat côté client.

## Envoi de pièces

- Depuis le bouton d'ajout d'une ligne `fileRequest` ou du composeur : `POST /v1/files` (corps brut `application/octet-stream`, en-tête `X-File-Mime-Type`, `Idempotency-Key`), puis un message `{ type: file, fileId, documentType }` (`audio {fileId}` pour un vocal ; le type `image` n'existe plus).
- Limites : 10 Mio maximum ; PDF, JPEG, PNG, OGG, MP3, M4A, WEBM (intersection des formats demandés par le bloc et du contrat). Le proxy refuse aussi en 413 (`FILE_TOO_LARGE`) au-delà de 10 Mio.
- Validation côté client avant l'envoi (taille, fichier vide, format) ; le nom du fichier reste local et n'est jamais transmis au backend.
- En cas d'échec, « Réessayer » réutilise le même `Idempotency-Key` (sauf erreurs 413/415).

## Questions de contrat ouvertes

- Encodage des réponses de formulaire : `Content.interaction` n'a que `actionId` et `value`. Provisoire : `actionId = form.id` et `value` = JSON des valeurs (`src/lib/interactions.ts`), à confirmer avec le Backend.
- Refus d'un consentement : `ConsentInput.accepted` est `true` seulement ; le refus reste local (le Backend n'en est pas informé).
- Administration d'un dossier : le contrat ne donne que `administrationId` (ex. `justice`) ; l'interface l'affiche lisible (première lettre en majuscule), sans nom officiel.
- `caseCard` et `requestCard` arrivent comme blocs d'un message `message.sent` (§7.2).
