# admin-console

Console d’administration (Next.js 16, React 19, Tailwind v4) : première tranche du contrat C3. Lecture seule pour l’instant (tableau de bord, fiches de démarche, modèles, outils, conversations, journal d’audit) ; le client `updateModel/Tool/Procedure` est prêt pour l’édition.

## Lancer en local

```bash
cp apps/interface/admin-console/.env.example apps/interface/admin-console/.env.local
pnpm mocks                                       # à la racine : backend simulé sur 127.0.0.1:4010
pnpm --filter @techma/admin-console dev          # http://localhost:3100
```

Autres commandes : `pnpm --filter @techma/admin-console test | typecheck | build`.

## Architecture

- Le navigateur n'a jamais de jeton : tout appel C3 passe par `/api/admin/[...path]` qui délègue à `src/server/admin-proxy.ts`.
- Le proxy applique une liste blanche stricte (GET listes et métriques, PUT `models|tools|procedures/{id}`), ne relaie que `cursor` et `limit`, les en-têtes `content-type`, `idempotency-key`, `traceparent`, plafonne le corps PUT à 64 Kio et injecte `Authorization` (`src/server/admin-token.ts`, simulation uniquement ; la production lève tant que la session OIDC administrateur n'est pas branchée).
- `src/lib/c3-client.ts` : client C3 typé (types générés `@techma/contracts-ts`), `traceparent` neuf à chaque appel, `Idempotency-Key` fournie par l'appelant sur les PUT.
- `src/components/paginated-table.tsx` : tableau paginé réutilisable (`cursor` opaque, « Charger plus »).

Design : fondation « Sceau » de `@techma/ui` (tables denses, jetons uniquement).
