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

## Palier 2 — Tooling (à documenter après merge + audit)

En attente.

## Palier 3 — Interface + vérification (à documenter après merge + tests)

En attente.
