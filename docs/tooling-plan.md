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

| Branche | Contenu | État |
|---|---|---|
| `tooling/service-scaffold` | Service NestJS, configuration, `/health`, `traceparent`, erreurs problem+json | Poussée |
| `tooling/mcp-gateway` | Passerelle MCP authentifiée, `procedures.search` et `procedures.get` | Poussée |
| `tooling/persistence` | Base, sécurité des lignes, journal, idempotence, mandats, outils d'action | Poussée |
| `tooling/events-outbox` | Publication des événements avec reprise et ordre par conversation | Poussée |
| `tooling/resilience` | Superviseur, garde-fous, image, déploiement à deux répliques | Poussée |
| `tooling/hardening` | Limitation de débit, `Retry-After`, TLS au proxy, tests sur PostgreSQL réel et à deux répliques, CI avec PostgreSQL | Poussée |
| `tooling/observability` | Traces OpenTelemetry, métriques, tests d'attaque avant le 3 novembre | À faire |

Les branches s'empilent : chacune part de la précédente. Les PR vers `dev` suivent cet ordre.

Jalons du cadre technique : outils de lecture réels au 29 octobre, passerelle mandat et outils d'action au 31 octobre, journée d'attaque le 3 novembre, démonstration le 6 novembre.

## Décisions à valider avec les autres groupes

La suite `tests/integration.test.mjs` exige les deux URL et fait passer le consentement par le Backend simulé, qui accorde le mandat dans sa propre mémoire. Elle ne peut donc pas tester un Tooling réel seul. Nous proposons un mode Tooling seul qui appelle directement notre route interne de mandat. Le fichier est commun : relecture Backend requise.

Le Backend doit nous fournir tôt le JWKS qui signera `proofToken`, et une date pour son API de ressources réelle. Notre jalon du 31 octobre en dépend.

Le Tooling ne publie pas `mandate.granted` ni `mandate.revoked` : le Backend les émet déjà à partir de la réponse synchrone. À confirmer pour éviter un double envoi.

Le contrat n'a pas de code d'erreur pour une panne interne (500). Le service renvoie `INVALID_REQUEST`, comme les simulations ; un code dédié serait plus juste.

La collecte des vraies fiches sourcées passe par le responsable contenu. Jusqu'au pilote, uniquement des données fictives.

## Suivi

Chaque étape part sur une branche `tooling/<tâche>` et revient par PR vers `dev`, avec `pnpm check` vert.
