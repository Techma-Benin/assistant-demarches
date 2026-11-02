# X-Road simulé

Simulation déclarée des administrations reliées par X-Road (contrat C5, [`contracts/v2/xroad.openapi.json`](../../contracts/v2/xroad.openapi.json), conception dans [`docs/xroad-sim.md`](../../docs/xroad-sim.md)). Aucune donnée ne vient d'une vraie administration : chaque dossier porte `simulated: true` et une référence `SIM-…`, chaque document délivré est un PDF marqué « SIMULATION - SANS VALEUR ADMINISTRATIVE ».

```sh
pnpm --filter @techma/xroad-sim build
pnpm --filter @techma/xroad-sim start   # http://127.0.0.1:4040
pnpm --filter @techma/xroad-sim test
```

`http://127.0.0.1:4040/` affiche la vue des connexions demandée à l'appel du 29 octobre : administrations, état de connexion, nombre de dossiers et derniers échanges, sans donnée personnelle. `/health` répond sans authentification.

## Données

Par défaut tout est en mémoire et repart de zéro au redémarrage. Avec `XROAD_STATE_FILE`, les dossiers, les références, les affectations et les réponses idempotentes sont écrits dans ce fichier à chaque changement et relus au démarrage.

| Administration | Démarches | Instruction |
|---|---|---|
| Justice | Extrait de casier judiciaire | bloquée : nouvelle demande à vérifier par un agent du greffe |
| | Certificat de nationalité | bloquée : filiation à vérifier par un agent |
| Affaires étrangères | Légalisation d'un document | bloquée : signature à contrôler |
| Enseignement | Attestation d'authenticité de diplôme (gratuite) | complétée par l'assistant |
| | Relevé de notes du baccalauréat | complété par l'assistant après paiement |
| Santé | Duplicata de carnet de vaccination | bloquée : registre antérieur à la numérisation |
| Intérieur | aucune | non connectée, pour montrer la recommandation |

Agents : un super administrateur (`off_01JC0000000000000000000001`), puis pour chaque administration connectée un administrateur et un agent, numérotés à partir de 10 dans l'ordre du tableau (Justice : `…10` et `…11`, Affaires étrangères : `…12` et `…13`, etc.). `GET /v1/officials` sans `X-Official-Subject` les liste tous pour l'écran « se connecter en tant que ».

Au démarrage, quelques semaines de dossiers fictifs sont chargées pour que les tableaux de bord ne soient pas vides. `XROAD_SEED_HISTORY=off` démarre à vide.

## Identités

| Client | Jeton local | Scopes | Agit pour |
|---|---|---|---|
| `tooling-xroad` | `mock-tooling-xroad` | `xroad:apply` | l'usager de `X-Applicant-Ref` |
| `backend-xroad` | `mock-backend-xroad` | `xroad:apply`, `xroad:administer` | l'agent de `X-Official-Subject` |

Hors poste local, `AUTH_MODE=jwt` : JWT RS256 d'audience `techma-xroad`, client lu dans `azp` ou `client_id`, scopes dans `scope`.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `XROAD_HOST`, `XROAD_PORT` | `127.0.0.1`, `4040` | Écoute |
| `AUTH_MODE` | `mock-tokens` (`jwt` en production) | Jetons statiques réservés à une écoute locale hors production |
| `JWT_JWKS_URL`, `JWT_ISSUER` | aucun | Requis en mode `jwt` ; JWKS en HTTPS hors localhost |
| `XROAD_SEED_HISTORY` | `on` | Historique fictif, chargé seulement si le fichier d'état n'existe pas encore |
| `XROAD_STATE_FILE` | aucun | Fichier d'état conservé entre les redémarrages |
| `CONTRACTS_DIR` | `contracts/v2` du dépôt | Contrats dans une image |
