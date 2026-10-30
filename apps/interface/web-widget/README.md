# web-widget

Widget de chat web (Next.js 16, React 19, Tailwind v4) : première tranche de l'interface conversationnelle C1.

## Lancer en local

```bash
cp apps/interface/web-widget/.env.example apps/interface/web-widget/.env.local
pnpm mocks                                   # à la racine : backend simulé sur 127.0.0.1:4010
pnpm --filter @techma/web-widget dev         # http://localhost:3000
```

Autres commandes : `pnpm --filter @techma/web-widget test | typecheck | build`. Galerie des blocs (dev uniquement) : `/dev/blocks`.

## Architecture

- Le navigateur n'a jamais de jeton : tout appel C1 passe par `/api/backend/[...path]` (route Next) qui délègue à `src/server/backend-proxy.ts`.
- Le proxy applique une liste blanche (méthode + chemin), ne relaie que quelques en-têtes et injecte `Authorization` (`src/server/user-token.ts`, simulation uniquement).
- `src/lib/c1-client.ts` : client C1 typé (types générés `@techma/contracts-ts`), `traceparent` neuf à chaque appel, `Idempotency-Key` stable.
- `src/lib/conversation-state.ts` : réducteur pur (déduplication par `Event.id`, reprise par curseur) ; `src/hooks/use-conversation.ts` le relie au flux temps réel (voir « Temps réel »).
- `src/components/blocks/*` : un composant par type de bloc (`text`, `buttons`, `form`, `fileRequest`, `statusCard`), texte brut uniquement, liens http(s) seulement.

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

- Depuis le bouton « Joindre une pièce » du bloc `fileRequest` ou du composeur : `POST /v1/files` (corps brut `application/octet-stream`, en-tête `X-File-Mime-Type`, `Idempotency-Key`), puis un message `{ type: image | audio | file, fileId }`.
- Limites : 10 Mio maximum ; PDF, JPEG, PNG, OGG, MP3, M4A (intersection des formats demandés par le bloc et du contrat). Le proxy refuse aussi en 413 (`FILE_TOO_LARGE`) au-delà de 10 Mio.
- Validation côté client avant l'envoi (taille, fichier vide, format) ; le nom du fichier reste local et n'est jamais transmis au backend.
- Une pièce `rejected` n'est pas envoyée comme message ; en cas d'échec, « Réessayer » réutilise le même `Idempotency-Key` (sauf erreurs 413/415).

## Questions de contrat ouvertes

- Encodage des réponses de formulaire : non défini en v1. Provisoire : `interaction` avec `actionId = form.id` et `value` = JSON des valeurs (`src/lib/interactions.ts`), à confirmer avec le Backend.
- Jeton usager : l'échange session portail → jeton OIDC court n'est pas branché (CONTRACTS.md §3) ; seul le jeton `mock-user` fonctionne, en local.
- Pièces : pas d'analyse de contenu (décision du pivot, `docs/file-storage-decision.md`). Un fichier déposé est utilisable tout de suite.
- Rattachement d'une pièce à une demande : aucun moyen en v1 de lier un fichier déposé au `documentType` d'un bloc `fileRequest`.
