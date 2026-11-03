# tooling

Serveur MCP Techma du contrat v2 : brouillons de demande, mandats, dépôt des dossiers au X-Road simulé et suivi. Référence : [CONTRACTS.md](../../CONTRACTS.md) §7, §11 et §12, [spécification](../../docs/spec.md).

## Démarrer

```sh
pnpm dev                        # toute la pile (PostgreSQL, Keycloak, Backend, Tooling, X-Road, Interface)
pnpm dev tooling xroad          # PostgreSQL + Keycloak + Tooling + X-Road seuls
pnpm --filter @techma/tooling test
```

Le service écoute sur `http://127.0.0.1:4030`, un seul processus, base `tooling`. Les variables viennent de `scripts/dev/local-config.mjs`.

## Ce que fait le service

| Outil | Rôle |
|---|---|
| `procedures.search`, `procedures.get` | Catalogue lu au X-Road (fiches de service-public.bj). `filing` indique si l'assistant peut déposer. |
| `request.create` | Ouvre un brouillon pour une démarche déposable ; `NOT_ASSISTED` sinon. |
| `request.update` | Remplit les champs du formulaire officiel, avec leur provenance (`answer` ou `document`). |
| `documents.attach` | Rattache une pièce de l'usager à la ligne attendue (format et validité vérifiés, contenu jamais lu). |
| `request.submit` | Lit les pièces au Backend, les transmet au X-Road (`/v1/uploads`), dépose le dossier avec `X-Channel`, renvoie `{request, case}`. |
| `request.pay` | Paiement simulé, une seule fois par dossier. |
| `case.status` | État du dossier dans le X-Road. |
| `case.respond` | Réponse de l'usager à une demande de complément (message, champs, pièces). |

Un brouillon passe de `draft` à `ready` quand `missing` est vide, puis à `submitted` avec `caseId`. Après le dépôt, l'état fait foi dans le dossier X-Road.

Le suivi interroge les dossiers déposés toutes les 3 s (`TRACKING_POLL_MS`) et publie `case.updated` au Backend à chaque changement que la réponse d'un outil n'a pas déjà rapporté. Il s'arrête quand le dossier est `completed` ou `rejected`.

## Intégration

### Backend vers Tooling

| Route | Identité Keycloak | Règles |
|---|---|---|
| `POST /mcp` | client `backend`, audience `techma-tooling`, scope `tools:call` | `initialize` et `tools/list` sans contexte. `tools/call` exige `X-Conversation-Id` et `X-User-Ref` ; les actions exigent `X-Mandate-Id` et `Idempotency-Key` ; `request.submit` exige `X-Channel`. |
| `POST /internal/v1/mandates` | client `backend`, scope `mandates:grant` | Corps `MandateGrant`. `proofToken` signé par le Backend (JWKS `BACKEND_JWKS_URL`, audience `techma-mandate`, `jti` = id du challenge, `sub` = `userRef`, `conversationId`, `procedureId`, `scopes`, `exp`). Un challenge ne sert qu'une fois. Mandat d'une heure. |
| `POST /internal/v1/mandates/{id}/revoke` | client `backend`, scope `mandates:grant` | `X-User-Ref` du propriétaire, sinon 404. |

Les outils exigeant une connexion exigent aussi un mandat ou la propriété d'un dossier déposé : le Backend n'accorde un mandat qu'à un usager connecté.

Erreur métier d'un outil : `isError: true` et un bloc texte JSON `{code, detail, traceId}`. `tools/list` renvoie le catalogue de `contracts/v2/mcp.tools.json`, chaque schéma complété des définitions qu'il utilise et de `type: "object"` à la racine, comme l'exige le protocole MCP.

### Tooling vers Backend et X-Road

Un seul client sortant, `tooling` (client_credentials), audiences `techma-backend` et `techma-xroad`.

| Appel | Usage |
|---|---|
| `POST /internal/v1/events` (Backend) | `case.updated`, `tool.called`, `mandate.granted`, `mandate.revoked`, en `bj.techma.{kind}.v2`. Ordre garanti par conversation, livraison au moins une fois. |
| `GET /internal/v1/files/{id}` et `/content` (Backend) | Métadonnées et contenu d'une pièce, pour l'usager `X-User-Ref`. |
| X-Road (`X-Applicant-Ref`) | Catalogue, `uploads`, dépôt, paiement, lecture et réponses d'un dossier. |

## Tenue en cas de panne

- Les appels au Backend et au X-Road se font hors transaction ; une panne amont renvoie `UPSTREAM_UNAVAILABLE` sans rien écrire.
- Dépôt, paiement et réponse portent une clé d'idempotence vers le X-Road : un nouvel essai ne crée jamais un second dossier ni un second paiement.
- Outbox et suivi sont sûrs sur plusieurs instances (`FOR UPDATE SKIP LOCKED`, bail de 60 s) et réessaient avec un délai croissant.
- Sécurité au niveau des lignes sur toutes les tables ; journal d'audit en ajout seul.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `TOOLING_HOST`, `TOOLING_PORT` | `127.0.0.1`, `4030` | Écoute |
| `DATABASE_URL` | requis | PostgreSQL ; `pglite:memory` seulement avec `NODE_ENV=test` |
| `OIDC_ISSUER` | requis | Realm Keycloak ; JWKS et jeton dérivés (`OIDC_JWKS_URL`, `OIDC_TOKEN_URL` pour les remplacer) |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | `tooling`, requis | Client sortant |
| `BACKEND_URL` | requis | Backend |
| `BACKEND_JWKS_URL` | `BACKEND_URL/.well-known/jwks.json` | Clés des preuves de consentement |
| `PROOF_ISSUER` | aucun | Émetteur attendu des preuves, si fixé |
| `XROAD_URL` | requis | X-Road simulé |
| `EVENTS_PUBLISHER`, `EVENTS_INTERVAL_MS` | `on`, `500` | Publication de l'outbox |
| `TRACKING_WORKER`, `TRACKING_INTERVAL_MS`, `TRACKING_POLL_MS` | `on`, `1000`, `3000` | Suivi des dossiers |
| `RATE_LIMIT_USER_PER_MIN`, `RATE_LIMIT_CLIENT_PER_MIN`, `RATE_LIMIT_AUTH_FAILURES_PER_MIN` | `60`, `1200`, `20` | Limites de débit |
| `TRUST_PROXY` | `false` | Proxy de confiance pour `X-Forwarded-For` |

HTTPS est obligatoire pour toute URL hors localhost.
