# Plan Tooling

Groupe Tooling : `apps/tooling` et `content`. Ce document fixe l'organisation interne du service et le calendrier jusqu'à la démonstration du 6 novembre 2026. Il complète [CONTRACTS.md](../CONTRACTS.md) sans le modifier : en cas d'écart, le contrat prime.

## Ce que fait le service

Le Tooling donne ses mains à l'agent. Le Backend appelle nos huit outils par MCP ; la passerelle vérifie l'identité de l'appelant, le contexte et le mandat, inscrit l'appel au journal, puis exécute l'outil. Le Tooling ne choisit aucune action et ne tient aucune conversation.

Nous sommes seuls propriétaires des demandes, des mandats, du journal d'audit et des clés d'idempotence, dans notre propre base PostgreSQL. Les fiches et les métadonnées de pièces viennent du Backend par son API privée (`backend-resources.openapi.json`). Les changements d'état repartent vers le Backend sous forme d'événements C4, publiés depuis une table outbox écrite dans la même transaction que le changement.

Trois écarts entre le PDF et le dépôt nous concernent directement, et le dépôt fait foi. `request.submit` s'arrête à `awaiting_user_validation`, jamais `submitted`. Son scope est `requests:submit`. Les règles métier des outils vivent dans `_meta` sous les clés `bj.techma/`.

## Organisation du code

Un seul service NestJS, en modules :

| Module | Rôle |
|---|---|
| `config` | Lecture et validation des variables d'environnement au démarrage ; refus de démarrer si incohérent |
| `common` | `traceparent`, erreurs `application/problem+json`, en-têtes de sécurité |
| `auth` | Vérification JWT RS256 par client : `backend-agent` (`tools:call`) sur `/mcp`, `backend-mandates` (`mandates:grant`) sur `/internal/v1/mandates` |
| `gateway` | Serveur MCP Streamable HTTP (SDK officiel), contexte lu dans les en-têtes, idempotence, contrôle du mandat, journal, puis appel de l'outil |
| `tools` | Fiches (via l'API Backend), demandes (machine d'état), pièces (`FileAccess`, vérification technique) |
| `mandates` | Octroi : vérification du `proofToken`, comparaison des claims, consommation atomique du `jti`, durée 1 h. Révocation |
| `resources` | Client HTTP vers l'API privée du Backend, identité `tooling-resources` |
| `events` | Outbox et publication vers `/internal/v1/events`, identité `tooling-events`, reprise 1/2/4…60 s pendant 24 h |
| `persistence` | PostgreSQL, requêtes paramétrées, migrations, sécurité au niveau des lignes |

### Base de données

Requêtes SQL paramétrées avec `pg`, sans ORM : la sécurité au niveau des lignes exige de contrôler chaque transaction (rôle `tooling_app`, portée `app.user_ref`). PGlite (PostgreSQL embarqué) sert aux tests et au poste local, sans Docker. Tables : `requests`, `mandates`, `idempotency_keys`, `audit_log`, `outbox`. Migrations embarquées, appliquées au démarrage sous verrou consultatif.

La sécurité au niveau des lignes est activée et forcée sur toutes les tables. Pour `requests` et `mandates`, chaque transaction positionne `app.user_ref` et les politiques filtrent dessus : une erreur de filtre dans le code ne peut pas exposer la demande d'un autre usager. `audit_log` est en ajout seul, par un déclencheur qui s'applique même au propriétaire. Le journal et l'outbox ne sont lisibles que par les tâches système. Ce point dépasse ce qu'exige le contrat ; c'est un choix du groupe.

### Tenue en cas de panne

Le service ne garde aucun état métier en mémoire. Un superviseur lance plusieurs processus sur le même port, relance ceux qui s'arrêtent et remplace ceux qui ne battent plus. En déploiement, deux répliques tournent derrière un proxy qui écarte celle dont `/ready` échoue. Détail dans [apps/tooling/README.md](../apps/tooling/README.md).

### Authentification en local

Le service vérifie toujours de vrais JWT. Pour le développement, un script génère une paire de clés et un JWKS locaux, et émet des jetons de test. La suite partagée envoie des jetons statiques (`mock-agent`, `mock-backend-control`) : un mode `AUTH_MODE=mock-tokens` les accepte, uniquement si le service écoute sur `127.0.0.1`. Il refuse de démarrer dans tout autre cas.

## Avancement

| Branche | Contenu | Commits sur `tooling/service` | État |
|---|---|---|---|
| `tooling/service-scaffold` | Service NestJS, configuration, `/health`, `traceparent`, erreurs problem+json | `c3a59ac`, `3641ad1` | PR à ouvrir |
| `tooling/mcp-gateway` | Passerelle MCP authentifiée, `procedures.search` et `procedures.get` | `22595ba` | PR à ouvrir |
| `tooling/persistence` | Base, sécurité des lignes, journal, idempotence, mandats, outils d'action | `30fad05` | PR à ouvrir, revue sécurité |
| `tooling/events-outbox` | Publication des événements avec reprise et ordre par conversation | `8ba7387` | PR à ouvrir |
| `tooling/resilience` | Superviseur, garde-fous, image, déploiement à deux répliques | `add1bdf` | PR à ouvrir |
| `tooling/hardening` | Limitation de débit, `Retry-After`, TLS au proxy, tests sur PostgreSQL réel et à deux répliques, CI avec PostgreSQL | `058b091` | PR à ouvrir |
| `tooling/observability` | Traces OpenTelemetry, métriques, tests d'attaque avant le 3 novembre | | À faire |

Tout le travail livré est aujourd'hui sur la seule branche `tooling/service` (environ 4 400 lignes). Chaque ligne du tableau devient une branche pointant sur ses commits, puis une PR vers `dev`. Les branches s'empilent : chacune part de la précédente, et les PR sont fusionnées dans cet ordre. Le commit `2ee24ec` (retrait des commentaires) est à valider en binôme avant d'être intégré.

Jalons du cadre technique : outils de lecture réels au 29 octobre, passerelle mandat et outils d'action au 31 octobre, journée d'attaque le 3 novembre, démonstration le 6 novembre.

## Décisions à valider avec les autres groupes

La suite `tests/integration.test.mjs` exige les deux URL et fait passer le consentement par le Backend simulé, qui accorde le mandat dans sa propre mémoire. Elle ne peut donc pas tester un Tooling réel seul. Nous proposons un mode Tooling seul qui appelle directement notre route interne de mandat. Le fichier est commun : relecture Backend requise.

Le Backend doit nous fournir tôt le JWKS qui signera `proofToken`, et une date pour son API de ressources réelle. Notre jalon du 31 octobre en dépend.

Le Tooling ne publie pas `mandate.granted` ni `mandate.revoked` : le Backend les émet déjà à partir de la réponse synchrone. À confirmer pour éviter un double envoi.

Le contrat n'a pas de code d'erreur pour une panne interne (500). Le service renvoie `INVALID_REQUEST`, comme les simulations ; un code dédié serait plus juste.

La collecte des vraies fiches sourcées passe par le responsable contenu. Jusqu'au pilote, uniquement des données fictives.

## Répartition dans le binôme

Chacun avance de son côté, sur des fichiers différents, et relit les PR de l'autre.

### Naldo-56 : intégrer le service livré

1. Découper `tooling/service` en branches selon le tableau d'avancement et ouvrir les PR dans l'ordre.
2. Traiter les retours de relecture :
   - Les outils d'action appellent le Backend (`catalog.get`, `resources.getFile`) pendant que la transaction PostgreSQL garde ses verrous (`src/requests/requests.module.ts`). Un Backend lent peut bloquer tout le pool de connexions. Lire fiche et pièce avant d'ouvrir la transaction, ou borner le temps d'attente.
   - `PROCEDURES_ALLOW_DRAFTS` vaut `true` dès que `NODE_ENV` n'est pas `production` (`src/config.ts`). Un environnement de test déployé sans cette variable accepterait des fiches en brouillon. Préférer un refus par défaut hors poste local.
   - Retrait des commentaires (`2ee24ec`) : garder au moins la justification des politiques de sécurité au niveau des lignes et des choix de sécurité.
3. Suite aux PR, rester propriétaire de `src/gateway`, `src/requests`, `src/mandates`, `src/database`, `src/events`.

### byKenVi : fiabiliser, observer, coordonner

1. `tooling/test-windows` : faire passer `pnpm check` sous Windows et le rendre plus rapide. Les deux tests de `test/supervisor.test.ts` échouent sous Windows : démarrage PGlite de 7 à 21 s pour un délai de 20 s, aucun signal `SIGKILL` rapporté, `SIGTERM` sans arrêt propre. La suite Tooling dure environ 4 min et `pnpm check` la lance désormais pour toutes les équipes : sortir les tests de résilience lents de `check` et les garder en CI.
2. `tooling/observability` : traces OpenTelemetry, métriques, préparation des tests d'attaque du 3 novembre.
3. Mode « Tooling seul » de `tests/integration.test.mjs`, décrit plus haut. Fichier commun : relecture Backend.
4. Coordination avec le Backend : JWKS du `proofToken` (bloquant pour le 31 octobre), date de l'API de ressources réelle, émetteur de `mandate.*`. Prévenir aussi que `/mcp` refuse `tools/list` sans les en-têtes de contexte (`X-Conversation-Id`, `X-User-Ref`) : c'est conforme au contrat, mais gênant si l'agent liste les outils au démarrage.
5. Fiches fictives dans `content/`.
6. Relire chaque PR de Naldo-56.

Fichiers à risque de conflit : `src/app.ts`, `package.json`, `pnpm-lock.yaml`, `src/database/migrations.ts`. Limiter les modifications à l'enregistrement d'un module ou d'une dépendance, et prévenir l'autre avant de toucher aux migrations.

## Règles de commit et de PR

Ces règles déclinent [CONTRIBUTING.md](../CONTRIBUTING.md) pour le Tooling ; en cas d'écart, CONTRIBUTING.md prime.

### Branches

- Une branche par tâche, `tooling/<tâche>` (ou `docs/<sujet>`), créée depuis `dev`, ou depuis la branche précédente tant que la pile n'est pas fusionnée.
- Deux jours maximum. Au-delà, découper.
- Rebaser au moins une fois par jour : `git fetch origin && git rebase origin/dev`.
- Jamais de force-push sur `dev`, `main` ou la branche de l'autre. Sur sa propre branche, uniquement `git push --force-with-lease`.

### Commits

- Format Conventional Commits, en anglais, à l'impératif, sans majuscule ni point final, 72 caractères maximum : `type(tooling): sujet`.
- Types : `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Un changement logique par commit. Le corps explique le pourquoi quand il n'est pas évident.
- Exemples :
  - `feat(tooling): add request.submit with official link`
  - `fix(tooling): release db transaction before backend calls`
  - `test(tooling): skip signal assertions on windows`
- Ne jamais committer : secrets, `.env`, données réelles, `dist/`, ni les fichiers de `packages/contracts-ts/src` modifiés uniquement par les fins de ligne sous Windows (`git checkout -- packages/contracts-ts/src`).

### Pull requests

- Cible : `dev`. Remplir la checklist du modèle de PR.
- `pnpm check` vert en local et en CI avant de demander une relecture.
- Relecture obligatoire par l'autre membre du binôme. Ajouter un relecteur Backend dès que la PR touche C2, C4, les routes internes de mandat ou l'API de ressources.
- Revue sécurité pour : mandats, authentification, données personnelles, connecteurs.
- Un changement de contrat (`contracts/v1/`) passe par une PR dédiée : contrat, exemples, simulation et tests ensemble, plus incrément de `contracts/manifest.json`.
- Les protections de branche ne sont pas actives : la relecture repose sur notre discipline. Pas de fusion sans approbation.

## Suivi

Chaque étape part sur une branche `tooling/<tâche>` et revient par PR vers `dev`, avec `pnpm check` vert.
