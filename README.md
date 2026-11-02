# Assistant-démarches — Techma Bénin

L'usager fait sa démarche administrative dans une conversation (web ou WhatsApp) : il s'informe sur la fiche officielle, prépare, dépose, paie et suit. Le dossier arrive dans une console unique pour tous les ministères, au-dessus d'un X-Road simulé.

À lire dans cet ordre :
1. [Spécification fonctionnelle](docs/spec.md) : ce que l'application fait.
2. [Contrat v2](CONTRACTS.md) et `contracts/v2/` : la seule référence entre les équipes.
3. [Architecture](docs/architecture.md) : services, processus, décisions.
4. [Tâches par équipe](docs/taches.md) : ce qui reste à construire.

## Démarrer

Prérequis : Node.js 22 et pnpm 10.20.0 (`corepack enable`). Pas de Docker, pas de Java, pas de PostgreSQL à installer.

Le backend se lance avec [BACKEND.md](BACKEND.md) : copier `.env.example`, renseigner `MODEL_API_KEY`, puis `pnpm dev backend`. La même clé active la transcription des vocaux (pas de `TRANSCRIPTION_ENABLED` ; décision produit de l'utilisateur Billux).

`pnpm dev` sans argument démarre aussi le tooling, le X-Road simulé et l'interface. Ces trois applications ne sont pas encore prêtes pour cette commande. Le détail est dans [BACKEND.md](BACKEND.md).

| Commande | Effet |
|---|---|
| `pnpm dev backend` | Backend, avec PostgreSQL et Keycloak locaux si `.env` ne les définit pas |
| `pnpm dev:infra` | PostgreSQL et Keycloak seulement |
| `pnpm dev` | L'infrastructure et toutes les applications citées dans le script |
| `pnpm dev:reset` | Efface les données locales (bases, realm, fichiers) |
| `pnpm check` | Contrats, types générés, typage et tests de toutes les applications |
| `pnpm catalogue:import` | Réimporte le catalogue de service-public.bj |

Comptes de démo, mot de passe `demo-2026` :

| Compte | Rôle |
|---|---|
| `aminata.usager` | Usager |
| `agent.justice`, `admin.justice` | Agent et admin de la Justice |
| `agent.enseignement` | Agent de l'Enseignement |
| `agent.anip` | Agent de l'ANIP |
| `super.admin` | Super admin, toutes les administrations |
| `operateur` | Écran opérateur |

Console Keycloak : <http://127.0.0.1:8080> (admin / admin, poste local uniquement). Si le port 8080 est déjà pris (service Oracle ou EnterpriseDB sous Windows par exemple) : `KEYCLOAK_PORT=8081 pnpm dev`, ou `$env:KEYCLOAK_PORT=8081; pnpm dev` dans PowerShell.

## Qui travaille où

| Équipe | Dossiers |
|---|---|
| Interface | `apps/interface/*`, `packages/ui` |
| Backend | `apps/backend`, `prompts` |
| Tooling | `apps/tooling`, `apps/xroad-sim`, `content` |
| Commun | `contracts`, `packages/contracts-ts`, `infra`, `scripts` |

Branches et revue : [CONTRIBUTING.md](CONTRIBUTING.md). Échéance : démonstration complète le 6 novembre 2026.
