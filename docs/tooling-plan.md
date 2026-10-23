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

Drizzle ORM avec `pg` en exécution, PGlite (PostgreSQL embarqué) dans les tests pour ne pas dépendre de Docker sur les postes. Tables prévues : `requests`, `mandates`, `consumed_challenges`, `idempotency_keys`, `audit_log`, `outbox`.

La sécurité au niveau des lignes est activée sur toutes les tables. Pour `requests` et `mandates`, chaque transaction positionne `app.user_ref` et les politiques filtrent dessus : une erreur de filtre dans le code ne peut pas exposer la demande d'un autre usager. `audit_log` est en ajout seul : le rôle applicatif n'a ni `UPDATE` ni `DELETE`. Les tables sans notion d'usager ont une politique limitée au rôle du service. Ce point dépasse ce qu'exige le contrat ; c'est un choix du groupe.

### Authentification en local

Le service vérifie toujours de vrais JWT. Pour le développement, un script génère une paire de clés et un JWKS locaux, et émet des jetons de test. La suite partagée envoie des jetons statiques (`mock-agent`, `mock-backend-control`) : un mode `AUTH_MODE=mock-tokens` les accepte, uniquement si le service écoute sur `127.0.0.1`. Il refuse de démarrer dans tout autre cas.

## Calendrier

| Date | Jalon PDF | Livrable Tooling |
|---|---|---|
| 23 oct. | Jour 2 | Branche, Node 22, `pnpm check` vert. Service NestJS minimal : configuration, `/health`, `traceparent`, erreurs problem+json, tests |
| 24 au 27 oct. | Jour 6 | Authentification, passerelle MCP, contexte, `procedures.search` et `procedures.get` sur le Backend simulé. Base, migrations, sécurité des lignes |
| 29 oct. | Jour 8 | Outils de lecture réels de bout en bout, journal d'audit, événements `tool.called` via outbox. Suite de conformité Tooling seule |
| 31 oct. | Jour 10 | API de contrôle des mandats avec preuve signée, quatre outils d'action, idempotence, machine d'état, événements `request.*`, révocation |
| 1er au 3 nov. | Jour 13 | Durcissement avant la journée d'attaque : tests négatifs (portée, propriétaire, rejeu, expiration, révocation, idempotence concurrente), limitation de débit, journaux sans donnée personnelle, traces OpenTelemetry |
| 4 au 6 nov. | Jour 16 | Déploiement de test, fiches synthétiques dans `content`, répétition de la démonstration |

## Décisions à valider avec les autres groupes

La suite `tests/integration.test.mjs` exige les deux URL et fait passer le consentement par le Backend simulé, qui accorde le mandat dans sa propre mémoire. Elle ne peut donc pas tester un Tooling réel seul. Nous proposons un mode Tooling seul qui appelle directement notre route interne de mandat. Le fichier est commun : relecture Backend requise.

Le Backend doit nous fournir tôt le JWKS qui signera `proofToken`, et une date pour son API de ressources réelle. Notre jalon du 31 octobre en dépend.

La collecte des vraies fiches sourcées passe par le responsable contenu. Jusqu'au pilote, uniquement des données fictives.

## Suivi

Chaque étape part de `dev` sur une branche `tooling/<tâche>` et revient par PR vers `dev`, avec `pnpm check` vert. Ordre prévu des branches : `tooling/service-scaffold`, `tooling/mcp-gateway`, `tooling/persistence`, `tooling/read-tools`, `tooling/mandates`, `tooling/action-tools`, `tooling/events-outbox`, `tooling/hardening`.
