# tooling

Service NestJS du groupe Tooling : passerelle MCP, mandats, demandes, journal d'audit, événements C4. Plan : [docs/tooling-plan.md](../../docs/tooling-plan.md). Contrats : [CONTRACTS.md](../../CONTRACTS.md).

## Démarrer

```sh
pnpm --filter @techma/tooling test     # compile puis lance node --test (PGlite)
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
  pnpm --filter @techma/tooling test   # même suite sur un PostgreSQL réel, plus les tests à deux répliques
pnpm --filter @techma/tooling build
pnpm mocks                             # Backend simulé sur 4010 (autre terminal)
AUTH_MODE=mock-tokens pnpm --filter @techma/tooling start
```

Le service écoute sur `http://127.0.0.1:4030`. Sans `DATABASE_URL`, il utilise PostgreSQL embarqué en mémoire (PGlite) : rien à installer, données perdues à l'arrêt. La simulation Tooling du dépôt reste sur 4020 ; pointer le Backend vers 4030 pour utiliser le vrai service.

Systèmes pris en charge : Linux, macOS et Windows, avec Node.js 22. La CI exécute `pnpm check` sur les trois. Le superviseur demande l'arrêt à ses processus par IPC, ce qui fonctionne partout ; il s'arrête proprement sur `SIGTERM` ou `SIGINT` (Linux, macOS, Docker), sur `Ctrl+C` ou `SIGBREAK` (Windows), ou sur un message `{ "type": "shutdown" }` de son processus parent. Un processus de service dont le superviseur disparaît s'arrête de lui-même.

## Intégration pour les autres groupes

### Backend, agent : `POST /mcp`

MCP Streamable HTTP sans session, SDK officiel. Chaque requête porte :

| En-tête | Valeur |
|---|---|
| `Authorization` | `Bearer` du client `backend-agent`, audience `techma-tooling`, scope `tools:call` |
| `traceparent` | W3C v00 |
| `X-Conversation-Id`, `X-User-Ref` | Contexte construit par le code du Backend, jamais par le modèle |
| `X-Mandate-Id` | Pour les outils d'action |
| `Idempotency-Key` | Obligatoire pour les outils d'action ; stable pour une même tentative métier |

Catalogue : `tools/list` renvoie exactement `contracts/v1/mcp.tools.json`. Erreur métier : `isError: true` et un bloc texte JSON `{code, detail, traceId}`.

### Backend, consentement : `POST /internal/v1/mandates` et `POST /internal/v1/mandates/{id}/revoke`

Client `backend-mandates`, scope `mandates:grant`, `Idempotency-Key` obligatoire. Corps `MandateGrant`. Hors mode local, `challenge.proofToken` doit être un JWT RS256 signé par le Backend (audience `techma-mandate`, `jti` = id du challenge, `sub` = `userRef`, `conversationId`, `procedureId`, `scopes`, `exp` = `expiresAt`), publié sur le JWKS indiqué par `PROOF_JWKS_URL`. Un challenge ne sert qu'une fois.

Le Tooling ne publie pas `mandate.granted` ni `mandate.revoked` : le Backend reçoit le mandat en réponse synchrone et le diffuse lui-même, comme le fait la simulation.

### Ce que le Tooling attend du Backend

| Besoin | Route Backend | Identité Tooling |
|---|---|---|
| Fiches | `GET /internal/v1/procedures`, `GET /internal/v1/procedures/{id}` | `tooling-resources`, scope `resources:read` |
| Métadonnées de pièces | `GET /internal/v1/files/{id}` avec `X-User-Ref` | `tooling-resources` |
| Événements | `POST /internal/v1/events`, `Idempotency-Key` = id d'événement | `tooling-events`, scope `events:publish` |

Événements publiés : `request.created`, `request.status_changed`, `tool.called`. Ordre garanti par conversation, livraison au moins une fois, id stable entre les reprises.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/gateway` | Passerelle MCP, registre des outils, chemin d'exécution commun (idempotence, mandat, sortie, journal, événements) |
| `src/procedures`, `src/requests` | Outils, inscrits au registre par leur module ; aucun ne connaît la passerelle |
| `src/mandates` | Contrôle des mandats et vérification à chaque action |
| `src/auth` | JWT entrants, jetons client credentials sortants, preuves de consentement |
| `src/database` | Port `Database` (PostgreSQL ou PGlite), migrations, sécurité au niveau des lignes |
| `src/events` | Outbox, publication, entretien |
| `src/runtime` | Superviseur et garde-fous des processus |

Ajouter un outil : un `ToolHandler` dans un module qui l'inscrit au `ToolRegistry` en `onModuleInit`. La passerelle se charge du reste. Un outil d'action qui n'appelle pas `requireMandate` est refusé.

## Tenue en cas de panne

| Panne | Comportement |
|---|---|
| Exception non rattrapée | Le processus ferme ce qu'il peut, sort en échec, le superviseur le relance |
| Processus bloqué | Plus de battement de cœur : tué et remplacé au bout de 30 s |
| Arrêts répétés | Relance après 1, 2, 4… jusqu'à 30 s ; jamais d'abandon |
| Superviseur arrêté | Docker relance le conteneur (`restart: unless-stopped`) |
| Réplique indisponible | Le proxy la retire via `/ready` ; l'autre réplique sert |
| Base indisponible | Réponses 503, `/ready` en échec, reconnexion automatique ; au démarrage, sortie et relance jusqu'au retour de la base |
| Backend indisponible | Outils en `UPSTREAM_UNAVAILABLE`, événements gardés et repris pendant 24 h |
| Processus arrêté en pleine publication | Bail de 60 s : un autre processus reprend les événements |
| Agent qui boucle | 60 appels d'outils par minute et par usager, puis `RATE_LIMITED` avec délai |
| Essais de jetons | 20 échecs d'authentification par minute et par adresse, puis 429 pour cette adresse |

Aucun état métier n'est gardé en mémoire : idempotence, mandats et événements sont en base, donc n'importe quel processus ou réplique peut servir n'importe quel appel. Avec PGlite, un seul processus est permis ; la redondance demande PostgreSQL.

`/health` : le processus répond. `/ready` : la base répond et le schéma est à jour. Le Backend n'entre pas dans `/ready`, pour que sa panne ne retire pas le Tooling.

Les compteurs de débit sont en base, partagés par tous les processus et répliques ; leurs clés sont hachées. Les réponses 429 et 503 portent `Retry-After`.

## Déploiement de test

`deploy/compose.yaml` : PostgreSQL 16, deux répliques, proxy Caddy en HTTPS sur `127.0.0.1:4443` (HTTP refusé). Voir l'en-tête du fichier. Le rôle de connexion doit pouvoir créer le rôle `tooling_app` à la première migration.

Ce qui a été vérifié sans Docker, avec les binaires officiels : la suite complète sur PostgreSQL 16.14 ; le `Caddyfile` validé par Caddy 2.10 ; deux instances derrière Caddy en TLS 1.3, l'une tuée, 30 requêtes sur 30 servies par l'autre, puis retour automatique de la première. Pas encore exécutés : l'image Docker et le fichier compose eux-mêmes.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `TOOLING_HOST` / `TOOLING_PORT` | `127.0.0.1` / `4030` | Écoute |
| `TOOLING_WORKERS` | 2 avec PostgreSQL, 1 avec PGlite | Processus de service sous le superviseur |
| `NODE_ENV` | | `production` exige PostgreSQL et `BACKEND_URL`, interdit `mock-tokens` et les fiches en brouillon |
| `DATABASE_URL` | `pglite:memory` hors production | `postgres://…`, `pglite:memory` ou `pglite:/chemin` |
| `DATABASE_POOL_MAX` | 10 | Connexions par processus |
| `BACKEND_URL` | `http://127.0.0.1:4010` hors production | API privée du Backend |
| `AUTH_MODE` | `jwt` | `mock-tokens` : jetons statiques de la suite partagée, écoute locale hors production seulement |
| `JWT_ISSUER`, `JWKS_URL`, `OIDC_TOKEN_URL` | | Realm Keycloak ; mode `jwt` |
| `TOOLING_RESOURCES_CLIENT_ID` / `_SECRET` | | Identité sortante vers les ressources ; mode `jwt` |
| `TOOLING_EVENTS_CLIENT_ID` / `_SECRET` | | Identité sortante vers les événements ; mode `jwt` |
| `PROOF_JWKS_URL`, `PROOF_ISSUER` | | Clés des preuves de consentement ; mode `jwt` |
| `PROCEDURES_ALLOW_DRAFTS` | `true` hors production | Fiches en brouillon visibles |
| `EVENTS_PUBLISHER`, `EVENTS_INTERVAL_MS` | `on`, 1000 | Publication de l'outbox |
| `RATE_LIMIT_USER_PER_MIN` | 60 | Appels d'outils par usager |
| `RATE_LIMIT_CLIENT_PER_MIN` | 1200 | Requêtes par client de service |
| `RATE_LIMIT_AUTH_FAILURES_PER_MIN` | 20 | Échecs d'authentification par adresse avant blocage |
| `TRUST_PROXY` | `false` | Réseaux autorisés à fournir `X-Forwarded-For` (`loopback`, `uniquelocal`…) |
| `CONTRACTS_DIR` | `contracts/v1` du dépôt | Contrats dans une image |

Toutes les URL de service doivent être en HTTPS hors localhost. Les secrets viennent de l'environnement et ne sont jamais journalisés. Entre le proxy et les répliques, le trafic reste en HTTP sur le réseau privé du déploiement.
