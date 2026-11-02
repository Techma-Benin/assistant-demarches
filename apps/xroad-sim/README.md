# X-Road simulé

Simulation déclarée des administrations reliées par X-Road. Contrat : [`contracts/v2/xroad.openapi.json`](../../contracts/v2/xroad.openapi.json) et [CONTRACTS.md](../../CONTRACTS.md) §8. Le catalogue vient de service-public.bj ; dépôt, paiement, décision et document délivré sont simulés : chaque dossier porte `simulated: true` et une référence `SIM-…`, chaque document délivré est un PDF marqué « SIMULATION - SANS VALEUR ADMINISTRATIVE ».

```sh
pnpm dev xroad                          # PostgreSQL + Keycloak + ce service, sur http://127.0.0.1:4040
pnpm --filter @techma/xroad-sim test    # sur un PostgreSQL en mémoire (PGlite, tests seulement)
```

`http://127.0.0.1:4040/` affiche la vue des connexions : administrations, état de connexion, nombre de dossiers et derniers échanges, sans donnée personnelle. `/health` répond sans authentification.

## Données

Tout est en base (`DATABASE_URL`), le schéma est créé au démarrage. La base démarre sans aucun dossier : les chiffres de la console sont ceux des dossiers réellement déposés.

| Administration | Démarche | Instruction |
|---|---|---|
| Justice | PS00373 casier judiciaire | bloquée : à vérifier par un agent |
| ANIP | PS00393 acte de naissance sécurisé | complétée par l'assistant |
| ANIP | PS00392 certificat d'identification personnelle | complétée par l'assistant |
| Enseignement | PS00254 authentification de diplôme | complétée par l'assistant |

Les autres fiches du catalogue sont en information seulement (`filing: null`), et le dépôt répond `NOT_ASSISTED`.

Annuaire : les agents de démo (`DEMO_OFFICIALS`, `src/data.ts`) sont inscrits au premier démarrage, avec les identifiants de `infra/keycloak/realm-techma.json`. Un test vérifie que les deux restent identiques.

## Identités

Uniquement des jetons Keycloak (RS256, JWKS du realm, audience `techma-xroad`, `azp` `tooling` ou `backend`).

| Accès | Scope | En-tête |
|---|---|---|
| Catalogue, administrations | `xroad:apply` ou `xroad:administer` | |
| Vue usager : dépôt, paiement, réponses, pièces, lecture | `xroad:apply` | `X-Applicant-Ref` |
| Vue agent : console, annuaire, indicateurs, journal | `xroad:administer` | `X-Official-Subject` (`sub` Keycloak) |

Une personne absente de l'annuaire reçoit 403 (404 sur `officials/me`), un compte désactivé 403, un dossier d'une autre administration 404.

## Configuration

| Variable | Rôle |
|---|---|
| `XROAD_HOST`, `XROAD_PORT` | Écoute, défaut `127.0.0.1:4040` |
| `DATABASE_URL` | Base `xroad` |
| `OIDC_ISSUER` | Realm Keycloak ; HTTPS hors poste local |
| `CATALOGUE_FILE` | `content/service-public/catalogue.json`, rafraîchi par `pnpm catalogue:import` |
