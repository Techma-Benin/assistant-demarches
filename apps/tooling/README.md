# tooling

Service NestJS du groupe Tooling : passerelle MCP, mandats, demandes, journal. Plan et calendrier : [docs/tooling-plan.md](../../docs/tooling-plan.md). Contrats : [CONTRACTS.md](../../CONTRACTS.md).

## État

En place : configuration validée au démarrage, `/health`, `traceparent` obligatoire ailleurs, erreurs `application/problem+json`, en-têtes de sécurité. La passerelle `POST /mcp` (Streamable HTTP, sans session) authentifie le client `backend-agent` (scope `tools:call`), valide le contexte transmis en en-têtes et publie le catalogue complet. `procedures.search` et `procedures.get` interrogent l'API privée du Backend sous l'identité `tooling-resources` ; en production, seules les fiches validées sortent.

Pas encore en place : journal d'audit, événements C4, mandats, idempotence et outils d'action. Ces derniers répondent `UPSTREAM_UNAVAILABLE` sans effet.

## Commandes

```sh
pnpm --filter @techma/tooling test    # compile puis lance node --test
pnpm --filter @techma/tooling build
pnpm --filter @techma/tooling start   # http://127.0.0.1:4030
```

Avec la simulation Backend du dépôt (`pnpm mocks`) :

```sh
AUTH_MODE=mock-tokens pnpm --filter @techma/tooling start
```

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `TOOLING_HOST` | `127.0.0.1` | Adresse d'écoute |
| `TOOLING_PORT` | `4030` | Port ; 4010 et 4020 restent aux simulations |
| `NODE_ENV` | | `production` interdit `mock-tokens`, exige `BACKEND_URL` et masque les fiches en brouillon |
| `BACKEND_URL` | `http://127.0.0.1:4010` hors production | API privée du Backend |
| `AUTH_MODE` | `jwt` | `mock-tokens` accepte les jetons statiques de la suite partagée, seulement en écoute locale hors production |
| `JWT_ISSUER` | | Realm Keycloak ; mode `jwt` |
| `JWKS_URL` | | Clés publiques du realm ; mode `jwt` |
| `OIDC_TOKEN_URL` | | Point de jeton client credentials ; mode `jwt` |
| `TOOLING_RESOURCES_CLIENT_ID` / `_SECRET` | | Identité sortante vers le Backend ; mode `jwt`, secret jamais commité |
| `CONTRACTS_DIR` | `contracts/v1` du dépôt | Emplacement des contrats dans une image |

Toutes les URL de service doivent être en HTTPS hors localhost.
