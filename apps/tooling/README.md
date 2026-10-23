# tooling

Service NestJS du groupe Tooling : passerelle MCP, mandats, demandes, journal. Plan et calendrier : [docs/tooling-plan.md](../../docs/tooling-plan.md). Contrats : [CONTRACTS.md](../../CONTRACTS.md).

État actuel : socle seulement. Configuration validée au démarrage, sonde `/health`, `traceparent` obligatoire ailleurs, erreurs `application/problem+json`, en-têtes de sécurité. Aucun outil MCP réel pour l'instant.

```sh
pnpm --filter @techma/tooling test    # compile puis lance node --test
pnpm --filter @techma/tooling build
pnpm --filter @techma/tooling start   # http://127.0.0.1:4030
```

| Variable | Défaut | Rôle |
|---|---|---|
| `TOOLING_HOST` | `127.0.0.1` | Adresse d'écoute |
| `TOOLING_PORT` | `4030` | Port ; 4010 et 4020 restent aux simulations |
| `AUTH_MODE` | `jwt` | `mock-tokens` accepte les jetons statiques de la suite partagée, seulement en écoute locale hors production |
| `NODE_ENV` | | `production` interdit `mock-tokens` |
