# X-Road simulé

Statut : proposition du Tooling du 29 octobre 2026, à relire par le Backend et l'Interface. Contrat machine : [`contracts/v1/xroad-sim.openapi.json`](../contracts/v1/xroad-sim.openapi.json).

## Pourquoi

Depuis l'appel du 29 octobre, le projet ne s'arrête plus au lien vers le portail officiel. L'usager dépose sa demande chez nous, et l'agent du ministère concerné la traite dans notre interface d'administration, la même pour tous les ministères.

Hypothèse annoncée au jury : X-Road relie déjà les back-ends de toutes les administrations. Nous le simulons dans un service séparé, `apps/xroad-sim`. Ce service joue les administrations : leur catalogue de démarches, leurs agents et leurs rôles, les dossiers déposés, le paiement et les documents délivrés. Chaque réponse porte `simulated: true` ou une référence `SIM-…` : la simulation ne se fait jamais passer pour une vraie administration.

## Qui appelle quoi

| Appelant | Identité | Pour le compte de | Usage |
|---|---|---|---|
| Tooling | client `tooling-xroad`, scopes `xroad:read`, `xroad:submit` | l'usager, en-tête `X-Applicant-Ref` (son `userRef`) | catalogue, dépôt, paiement, suivi |
| Backend | client `backend-xroad` prévu au contrat, scopes `xroad:read`, `xroad:administer` | l'agent connecté, en-tête `X-Official-Id` | dossiers, décisions, agents, indicateurs |

Dans le combo `integration/pivot-combo`, **le Backend n'appelle pas le X-Road**. Aucun client `backend-xroad` n'est branché dans `apps/backend`. La console métier passe par le Backend ; elle n'est pas encore alimentée par C5 (la slide 8 du PowerPoint n'est pas jouable). L'Interface n'appelle jamais le service directement. Le service simulé accepte encore l'identité `backend-xroad` pour ses propres tests, mais rien dans le Backend ne s'en sert. Les en-têtes `X-Applicant-Ref` et `X-Official-Id` sont construits par du code applicatif, jamais par le modèle.

## Modèle

- **Administration** : un ministère ou une agence (`justice`, `affaires-etrangeres`…). Ses thèmes servent à la navigation côté usager. `connection.status` vaut `not_connected` pour au moins une administration de la simulation, afin de montrer la recommandation « à connecter ».
- **Agent** (`Official`) : `role` vaut `agent` (traite les dossiers), `admin` (voit les agents de son administration) ou `super_admin` (voit toutes les administrations et affecte les agents). Un `super_admin` n'a pas d'`administrationId`.
- **Démarche** : le schéma `Procedure` existant. `administrationId` désigne l'administration qui la traite : c'est ce qui route le dossier.
- **Dossier** (`Case`) : la demande déposée. Il porte l'administration cible, les champs, les références des pièces, le paiement, les documents délivrés et la liste des étapes (`steps`).
- **Étape** (`CaseStep`) : ce qui a été fait, par qui (`assistant`, `applicant`, `administration`) et ce qui bloque. C'est elle qui affiche « voici ce que l'assistant a déjà complété, voici ce qui demande votre intervention ».

## Cycle de vie d'un dossier

```text
POST /v1/cases ─┬─ frais > 0 ──► awaiting_payment ── paiement ──┐
                └─ sans frais ──────────────────────────────────┴─► received
received ── instruction automatique ─┬─► completed   (completedBy: assistant)
                                     └─► in_review   (au moins une étape blocked)
in_review ── décision de l'agent ────┬─► completed   (completedBy: administration)
                                     └─► rejected
```

L'instruction automatique suit une règle propre à chaque démarche de la simulation. Par exemple, le casier judiciaire est délivré sans intervention, alors que le passeport exige une validation. Les deux tableaux de la console en découlent :

| Tableau | Filtre `view` | Contenu |
|---|---|---|
| En attente | `pending` | `in_review` : ce que l'assistant n'a pas pu terminer |
| Complété | `completed` | `completed`, quel que soit `completedBy` |

Correspondance avec la demande côté Tooling, via le connecteur `xroad` :

| Dossier | `RequestStatus` |
|---|---|
| `awaiting_payment`, `received` | `submitted` |
| `in_review` | `processing` |
| `completed` | `completed` |
| `rejected` | `rejected` |

Le Tooling suit les dossiers par interrogation (`GET /v1/cases/{caseId}`). La simulation n'émet pas d'événement.

## Visibilité

- `agent` et `admin` ne voient que les dossiers, les agents et les indicateurs de leur administration. Une autre administration donne 404, pas 403, pour ne pas révéler l'existence du dossier.
- `super_admin` voit tout, et filtre avec `administrationId`.
- Côté usager, un dossier n'est visible qu'avec le `X-Applicant-Ref` qui l'a déposé.

## Ce que ce contrat change dans la v1

- Contrat ajouté au manifeste **1.3.0** du pivot (départements, `blocked`, snapshots, `audio/webm`, `McpAuth`). Le document délivré par la simulation s'appelle `XroadIssuedDocument` : le nom `IssuedDocument` reste celui du pivot. `scanStatus` n'est pas réintroduit.
- CONTRACTS.md §7 : les états `submitted` et suivants restent produits uniquement par un connecteur. Le connecteur `xroad` vers ce service est admis en démonstration, parce que la simulation est annoncée comme telle. Le connecteur `simulated`, qui invente les statuts à partir du temps écoulé, reste réservé au poste local.

## Côté Tooling

- Le service `apps/xroad-sim` implémente ce contrat, avec des données fictives pour cinq ministères.
- Le connecteur `xroad` dépose et suit les dossiers depuis l'emplacement de connecteurs du Tooling.
- `procedures.search` et `procedures.get` lisent le catalogue de la simulation (`PROCEDURES_SOURCE=xroad`).
- L'outil MCP `request.pay` règle les frais, sous la portée `requests:submit` : le consentement du Backend n'a pas à changer.

## Points ouverts

- **Complément demandé à l'usager** : un état `awaiting_applicant` exigerait de rouvrir une demande déjà déposée côté Tooling. Il est hors de cette version.
- **Documents délivrés** : la simulation les stocke, comme le ferait l'administration émettrice. Reste à décider qui les relaie à l'usager : le Tooling par un outil, ou le Backend.
- **Authentification des agents** : le Backend doit savoir quel agent est connecté pour remplir `X-Official-Id`. Pour la démo, la console peut proposer de « se connecter en tant que » parmi `GET /v1/officials` appelé sans `X-Official-Id`. Cette liste complète n'a de sens qu'en simulation.
- **Photo de profil** : `avatarUrl` est en lecture seule ici. Le téléversement relève du Backend.
