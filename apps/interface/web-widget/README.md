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

## Questions de contrat ouvertes

- Encodage des réponses de formulaire : non défini en v1. Provisoire : `interaction` avec `actionId = form.id` et `value` = JSON des valeurs (`src/lib/interactions.ts`), à confirmer avec le Backend.
- Jeton usager : l'échange session portail → jeton OIDC court n'est pas branché (CONTRACTS.md §3) ; seul le jeton `mock-user` fonctionne, en local.
- WebSocket (`socket-ticket`) et envoi de pièces (`POST /v1/files`) : prévus dans des tâches ultérieures ; le polling est utilisé pour l'instant.
