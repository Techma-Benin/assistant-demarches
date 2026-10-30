# Journal d’intégration — pivot + Tooling + Interface

Branche : **`integration/pivot-combo`**.
Référence produit : PowerPoint du 29 octobre (`docs/Pivot-Assistant-demarches.pptx` dans le dossier parent) et compte rendu d’appel (`docs/compte-rendu-appel-2026-10-29.pdf`). L’ancien cadre C1–C4 n’est plus la boussole. Les OpenAPI du dépôt sont des implémentations en retard sur ce PowerPoint.

Remote de publication : `techma` (`git@github.com:Techma-Benin/assistant-demarches.git`). Jamais `main` / `dev`. Pas de force-push. Le worktree `integration/full-stack` n’est pas touché.

## Palier 1 — Départ (30 octobre 2026)

### Point de départ

| Élément | Valeur |
|---|---|
| Branche créée | `integration/pivot-combo` depuis `backend/department-pivot` |
| SHA de départ | `5ebbb5e` — *docs(backend): document pivot validation, integration and handoff* |
| Contrats | manifeste **1.3.0**, départements, files, statut d’intervention (`blocked`), snapshots versionnés, `audio/webm`, `McpAuth` |
| Scan antivirus | **absent** du pivot (volontaire) ; ne pas le réintroduire |
| Client Backend → X-Road | **absent** et doit le rester |

Le Backend pivot livre déjà l’annuaire / départements / KPI / commandes d’intervention, l’agent Groq, le consentement MCP, l’audio optionnel et les snapshots. Détail : [backend-pivot-status.md](backend-pivot-status.md).

### Ce qui sera fusionné ensuite

Ordre : **pivot → `techma/tooling/xroad-connector` → `techma/interface/redesign`**. On n’entre **pas** par le merge interne des quatre pointes Tooling : il a un conflit lockfile (`8f69f56`), `docs/xroad-sim.md` réécrit, et `tooling/demo-console` fourchée à part.

| Pointe | SHA au fetch | Rôle |
|---|---|---|
| `techma/tooling/xroad-contract` | `049d3f9` | contrat X-Road simulé (`xroad-sim.openapi.json`) |
| `techma/tooling/xroad-sim` | `021c182` | service `apps/xroad-sim` |
| `techma/tooling/backend-integration` | `abb4486` | pont Tooling ↔ Backend (ancêtre, sans X-Road) |
| `techma/tooling/xroad-connector` | `8cfa608` | entrée unique : connecteur X-Road + `request.pay` |
| `techma/interface/redesign` | `463b8e3` | look « Bonjour Bénin » (widget + console) |

Merge-base connector ↔ pivot : `fa43337`. Merge-base redesign ↔ pivot : `a4c13cd`.

Décisions déjà prises pour le combo :

- Catalogue de l’agent = X-Road simulé (`PROCEDURES_SOURCE=xroad`, `CONNECTORS=xroad` dans la stack).
- Paiement simulé = même consentement que le dépôt (`request.pay`, scope `requests:submit`). Aucun débit réel.
- Backend n’appelle pas X-Road. Une seule console métier, via le Backend.
- Un seul annuaire d’agents pour la démo.
- Pas le texte des conversations côté admin.
- Tout est annoncé comme simulation.
- Conflits : **garder le pivot** (1.3.0, départements, `blocked`, snapshots, `audio/webm`, `McpAuth`) ; **ajouter** `xroad-sim.openapi.json` et `request.pay` ; **pas** de `scanStatus` ; **pas** de client Backend → X-Road.

Si des livrables des pointes contract / sim / backend-integration manquent après le merge connector : merge séquentiel contract → sim → backend-integration → connector.

### Écart PowerPoint — slide 8 pas encore jouable

Le parcours exigé (slides 7, 8, 10, 14) :

1. Chat usager (« comment obtenir mon casier judiciaire ? »).
2. Dossier déposé **chez nous**, destination Justice.
3. Console : l’agent Justice voit **En attente (1)** ; l’agent Enseignement voit **En attente (0)**.
4. Un super admin voit toutes les administrations. Même écran, seules les données changent.
5. **Complété** : terminé, par l’IA ou par l’agent. Statut **bloqué**, intervention de l’administration (slide 14).

Après un merge brut, cet écart restera :

- Le X-Road simulé sait déjà si un dossier est fini tout seul (ex. casier) ou s’il attend un agent (ex. légalisation, vaccin).
- Le pont Tooling → Backend dit plutôt « traitement en cours » : il ne met **pas** encore le dossier dans **En attente** de la Justice.
- La console redesign n’affiche pas ces files. Elle montre encore l’ancien écran opérateur (modèles, outils, conversations). Elle n’a pas les onglets **En attente / Complété** ni les utilisateurs par ministère.

Donc **on n’aura pas la slide 8 en jouant le combo**. Ce n’est pas un détail de contrat mort : c’est le trou entre le PowerPoint et les trois bases actuelles. Hors de ce merge. À revalider après chaque palier.

## Palier 2 — Tooling (30 octobre 2026)

### Fusion

`git merge techma/tooling/xroad-connector` (`8cfa608`) dans `integration/pivot-combo`. Pas de merge séquentiel : aucun fichier des pointes `xroad-contract` (`049d3f9`), `xroad-sim` (`021c182`) ou `backend-integration` (`abb4486`) ne manquait sur le connecteur, ni dans l’arbre après fusion.

Le merge interne du connecteur (`8f69f56`) n’a pas été repris tel quel. `pnpm install` confirme que `pnpm-lock.yaml` est cohérent avec les manifestes (aucune régénération supplémentaire).

### Audit des quatre pointes

| Pointe | SHA | Dans le résultat |
|---|---|---|
| `xroad-contract` | `049d3f9` | Tous les fichiers présents. `contracts/v1/xroad-sim.openapi.json` est celui de la pointe, sauf le renommage `IssuedDocument` → `XroadIssuedDocument` (le pivot possède déjà un `IssuedDocument` différent). |
| `xroad-sim` | `021c182` | `apps/xroad-sim` identique à la pointe (contenu inchangé). |
| `backend-integration` | `abb4486` | Aucun fichier absent. Le Tooling a continué ensuite (connecteur `xroad`, `request.pay`) : on ne revient pas à cette pointe. |
| `xroad-connector` | `8cfa608` | Tous les fichiers présents, y compris `apps/tooling/src/xroad/xroad.client.ts` et `request.pay`. |

### Conflits et résolution

Fichiers en conflit : `CONTRACTS.md`, `contracts/manifest.json`, `contracts/v1/domain.schema.json`, `packages/contracts-ts/src/index.ts`, `scripts/generate-types.mjs`, `apps/tooling/src/gateway/mcp.controller.ts`.

- Manifeste **1.3.0** conservé, avec `department-admin`, `tooling-admin` et `xroad-sim.openapi.json`.
- Schéma partagé : départements, `blocked`, snapshots, `audio/webm`, `McpAuth` conservés. Schémas X-Road (administrations, dossiers, agents, paiement) ajoutés. `scanStatus` absent.
- `IssuedDocument` du pivot conservé. Le document délivré par la simulation s’appelle `XroadIssuedDocument`.
- `request.pay` ajouté, scope `requests:submit`. Catalogue : 9 outils.
- Découverte MCP sans en-tête de contexte conservée ; un contexte partiel reste refusé ; un appel d’outil sans contexte renvoie `INVALID_REQUEST`.
- Aucun client X-Road dans `apps/backend`. Le service simulé accepte encore l’identité `backend-xroad` pour ses tests, sans appelant Backend.
- Textes de démo Tooling qui parlaient d’antivirus alignés sur le stockage sans scan.

`pnpm contracts:check` : 99 schémas, 77 opérations HTTP, 9 outils MCP. `pnpm contracts:generate` a régénéré les types, dont `XroadIssuedDocument`.

### Adaptation de la pile

`pnpm --filter @techma/tooling dev:stack` démarre par défaut le X-Road simulé avec `PROCEDURES_SOURCE=xroad` et `CONNECTORS=xroad`. `CONNECTORS=simulated` ou `XROAD=off` retrouve l’ancienne pile locale. Le paiement simulé reste le même consentement que le dépôt. Le Backend n’appelle pas X-Road.

### Vérification de ce palier

- `pnpm --filter @techma/xroad-sim test` : 11 tests, 0 échec.
- `pnpm --filter @techma/tooling test` : 56 réussites, 2 ignorés (`TEST_DATABASE_URL` absent : répliques PostgreSQL). 0 échec.

### Écart PowerPoint

**La slide 8 n’est pas jouable.** Le X-Road simulé sait qu’un dossier est fini seul (casier) ou en attente d’un agent (légalisation, vaccin). Le pont Tooling traduit `in_review` en `processing`, pas en `blocked`, et ne range pas le dossier dans **En attente** de la Justice. La console n’a pas encore ces files. Hors de ce palier.

## Palier 3 — Interface (30 octobre 2026)

### Fusion

`git merge techma/interface/redesign` (`463b8e3`, *fix(web-widget): keep the composer fixed like a real chat*) dans `integration/pivot-combo` (`12c7738`).

Fichiers de l’interface conservés : console admin, widget web, adaptateur WhatsApp, `packages/ui` (look Bonjour Bénin). Contrats pivot **1.3.0** inchangés (départements, `blocked`, snapshots, `audio/webm`, `McpAuth`, pas de `scanStatus`), avec `xroad-sim.openapi.json` et `request.pay` (scope `requests:submit`). Le Backend n’appelle pas X-Road.

### Conflit et résolution

Seul chemin non fusionné : `pnpm-lock.yaml`. Pas de fusion manuelle. Fichier retiré, puis régénéré par `pnpm install` (pnpm 10.20.0). Le lockfile couvre les importers pivot, Tooling, `apps/xroad-sim` et l’interface. Aucun marqueur de conflit restant. Aucun autre chemin non fusionné.

### Écart PowerPoint

**La slide 8 (« un message, deux bureaux ») n’est pas jouable.** La console redesign n’a pas les files **En attente / Complété** ni le cloisonnement Justice / Enseignement. Le pont Tooling ne range toujours pas le dossier dans **En attente** de la Justice. Hors de ce merge.

## Palier 4 — Vérification (30 octobre 2026)

Point de contrôle : `integration/pivot-combo` à `118a1e6`, arbre propre, pas de merge en cours. Une seule correction ensuite : le test de contrats MCP attendait 8 outils découverts ; le catalogue en a 9 depuis `request.pay`.

### Présence

- `apps/xroad-sim` présent.
- `contracts/v1/xroad-sim.openapi.json` présent.
- `request.pay` présent dans `contracts/v1/mcp.tools.json`.
- `scanStatus` absent de `contracts/v1/domain.schema.json`.
- `blocked` et `request.snapshot` toujours là.

### Résultats

`node scripts/verify-backend-pivot.mjs` (Redis du runtime local), **après** la correction 8 → 9. Exit 0.

| Étape | Résultat |
|---|---|
| contracts | PASS — 99 schémas, 77 opérations HTTP, 9 outils MCP |
| generate-types | PASS |
| shared-types | PASS |
| build-backend | PASS |
| build-tooling | PASS |
| contract-tests | 10 réussites, 0 échec, 0 ignoré |
| backend-tests | 81 réussites, 0 échec, 0 ignoré |
| tooling-tests | 58 réussites, 0 échec, 0 ignoré (le script crée `TEST_DATABASE_URL`) |
| backend-tooling-integration | 7 réussites, 0 échec, 0 ignoré |

Avant cette correction, la même commande s’arrêtait sur contract-tests : 9 réussites, 1 échec (`9 !== 8` à la découverte MCP), 0 ignoré. Les étapes suivantes n’ont pas tourné sur ce premier passage.

Scripts `package.json`, lancés à part :

| Suite | Résultat |
|---|---|
| `pnpm --filter @techma/xroad-sim test` | 11 réussites, 0 échec, 0 ignoré |
| `pnpm --filter @techma/tooling test` | 56 réussites, 0 échec, 2 ignorés (`TEST_DATABASE_URL` absent : répliques PostgreSQL) |
| `pnpm --filter @techma/ui test` | 84 réussites, 0 échec, 0 ignoré |
| `pnpm --filter @techma/web-widget test` | 140 réussites, 0 échec, 0 ignoré |
| `pnpm --filter @techma/admin-console test` | 137 réussites, 0 échec, 0 ignoré |

Les quatre échecs d’interface sont alignés sur le pivot, sans réintroduire `scanStatus` :

- Widget : le dépôt de fichier n’attend plus `scanStatus` (absent de la réponse).
- Console : l’audit cherche `configuration.changed.updated` (kind `configuration.changed` et `operation` `updated`).
- Console : le libellé de jour suit le calendrier local du graphique, le même pour l’infobulle et pour « aujourd’hui », quel que soit le fuseau d’Intl.

### Suite Interface

Nouveau `git merge techma/interface/redesign` après `463b8e3`. Fusion sans conflit (`64738b2`). Contrats pivot inchangés : `blocked`, `request.snapshot`, `request.pay`, pas de `scanStatus`.

Commits repris, absents du combo avant cette fusion :

| SHA | Message |
|---|---|
| `cc50941` | *feat(web-widget): dock the question box and retitle the front door* |
| `99d279f` | *style(interface): use plain hyphens instead of em dashes in UI text* |

Pointe `techma/interface/redesign` : `99d279f`. Les comptes ci-dessus sont ceux d’après cette fusion (le widget gagne les tests du dock).

### Écart PowerPoint

**La slide 8 n’est toujours pas jouable.** Un message, deux bureaux : l’agent Justice devrait voir **En attente (1)** et l’agent Enseignement **En attente (0)**. Ce parcours n’est pas en place. Le pont ne range pas le dossier dans **En attente** de la Justice, et la console n’a pas ces files ni ce cloisonnement.

