# Assistant démarches — Techma Bénin

Socle de collaboration pour trois équipes : contrats v1, types générés, client TypeScript, simulations exécutables et tests. Le [Backend NestJS](apps/backend/README.md) implémente les parcours texte C1/C2/C3/C4, la configuration, les fichiers et un worker BullMQ. Le [Tooling MCP](apps/tooling/README.md) implémente les outils, mandats, demandes et événements. Les interfaces métier et les intégrations de déploiement restent à valider.

## Tester le Backend et le Tooling ensemble

Sur la branche `integration/backend-tooling`, `pnpm test:integration` vérifie les vrais services et `pnpm dev:integration` ouvre une pile locale avec Swagger sur le port 4110. Préparation des dépendances, parcours manuel et résultats attendus : [guide d’intégration](integration/README.md).

## Démarrer

Node.js 22 et pnpm 10.20.0 (version déclarée dans `package.json`). Si Corepack est disponible : `corepack enable`, puis `corepack prepare pnpm@10.20.0 --activate`.

```sh
git clone https://github.com/Techma-Benin/assistant-demarches.git
cd assistant-demarches
git switch dev
pnpm install --frozen-lockfile
pnpm check
pnpm mocks
```

Simulations en mémoire : Backend `http://127.0.0.1:4010`, Tooling `http://127.0.0.1:4020/mcp`. Écoute locale uniquement. Aucun fournisseur, aucune clé, aucune démarche officielle nécessaires. Tout est perdu au redémarrage.

**Lire [CONTRACTS.md](CONTRACTS.md) avant d'implémenter une frontière entre groupes.** Les JSON de `contracts/v1/` sont la référence machine ; le guide fixe les comportements et l'authentification. Le PDF technique décrit l'intention initiale ; les décisions précisées dans ce dépôt priment pour l'implémentation.

## Qui travaille où ?

| Équipe | Répertoires | Dépendances simulées |
|---|---|---|
| Interface | `apps/interface/whatsapp-adapter`, `web-widget`, `admin-console`, `packages/ui` | C1 + C3 et WebSocket sur le Backend simulé |
| Backend | `apps/backend`, `prompts`, `evals`, `packages/conversation-client` | Serveur MCP Streamable HTTP sur le Tooling simulé |
| Tooling | `apps/tooling`, `content` | Client MCP et fixtures dans les tests ; réception C4 simulée |
| Commun | `contracts`, `packages/contracts-ts`, `packages/observability`, `infra` | Tests et conventions partagés |

Les types C1/C3 sont générés par `pnpm contracts:generate` ; ne pas les modifier à la main. `pnpm check` valide schémas, OpenAPI, exemples, compilation TypeScript, parcours HTTP/MCP/WebSocket, suites Backend/Tooling et leur intégration réelle. Prévoir PostgreSQL et Redis pour le parcours intégré ; voir le [guide d’intégration](integration/README.md).

## Branches

`main` : livraison stable. `dev` : intégration. Chaque chantier part de `dev` et ouvre une PR vers `dev` :

```sh
git switch dev
git pull --ff-only
git switch -c interface/whatsapp-webhook
# ou backend/conversations, tooling/procedures-search
```

Branches courtes ; Conventional Commits ; CI verte ; relecture par un autre groupe ; revue sécurité pour mandat, authentification et données personnelles. Promotion `dev` → `main` par PR de livraison. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Documents

- [Contrats et comportements](CONTRACTS.md)
- [Architecture et décisions](docs/architecture.md)
- [Démarrage par équipe](docs/team-start.md)
- [Analyse des lacunes du PDF](docs/contract-review.md)
- [État de livraison et limites](docs/readiness.md)

Objectif interne : démonstration et dossier prêts le 6 novembre 2026. Selon le communiqué local, dépôt des candidatures du 29 octobre au 12 novembre 2026 ; règlement complet à confirmer avant candidature.
