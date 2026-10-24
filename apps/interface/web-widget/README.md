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
- `src/lib/conversation-state.ts` : réducteur pur (déduplication par `Event.id`, reprise par curseur) ; `src/hooks/use-conversation.ts` le relie au polling `GET …/events` (repli CONTRACTS.md §5).
- `src/components/blocks/*` : un composant par type de bloc (`text`, `buttons`, `form`, `fileRequest`, `statusCard`), texte brut uniquement, liens http(s) seulement.

## Design

Le widget utilise la fondation de design « Sceau » du paquet `@techma/ui` (tokens, thème Tailwind, composants) : voir `packages/ui/README.md`. Guide de style vivant (dev uniquement) : `/dev/design`.

## Envoi de pièces

- Depuis le bouton « Joindre une pièce » du bloc `fileRequest` ou du composeur : `POST /v1/files` (corps brut `application/octet-stream`, en-tête `X-File-Mime-Type`, `Idempotency-Key`), puis un message `{ type: image | audio | file, fileId }`.
- Limites : 10 Mio maximum ; PDF, JPEG, PNG, OGG, MP3, M4A (intersection des formats demandés par le bloc et du contrat). Le proxy refuse aussi en 413 (`FILE_TOO_LARGE`) au-delà de 10 Mio.
- Validation côté client avant l'envoi (taille, fichier vide, format) ; le nom du fichier reste local et n'est jamais transmis au backend.
- Une pièce `rejected` n'est pas envoyée comme message ; en cas d'échec, « Réessayer » réutilise le même `Idempotency-Key` (sauf erreurs 413/415).

## Questions de contrat ouvertes

- Encodage des réponses de formulaire : non défini en v1. Provisoire : `interaction` avec `actionId = form.id` et `value` = JSON des valeurs (`src/lib/interactions.ts`), à confirmer avec le Backend.
- Jeton usager : l'échange session portail → jeton OIDC court n'est pas branché (CONTRACTS.md §3) ; seul le jeton `mock-user` fonctionne, en local.
- WebSocket (`socket-ticket`) : prévu dans une tâche ultérieure ; le polling est utilisé pour l'instant.
- Suivi de l'analyse de sécurité : aucun endpoint ni événement ne permet de suivre un fichier `scanStatus: pending`. Les fichiers `pending` sont envoyés comme message quand même ; l'utilisabilité relève du Backend.
- Rattachement d'une pièce à une demande : aucun moyen en v1 de lier un fichier déposé au `documentType` d'un bloc `fileRequest`.
