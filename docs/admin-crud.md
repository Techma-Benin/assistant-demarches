> Évolution MCP : le CRUD par action décrit ici est désormais déprécié pour les outils. Les nouveaux écrans utilisent le [CRUD des connexions serveur MCP et la découverte](mcp-connections.md). Les modèles et fiches conservent le CRUD décrit ci-dessous.

# Administration : cycle de vie des configurations

Décision du 28 octobre 2026 : l'administration gère désormais la création, la lecture,
le remplacement et la suppression des modèles IA, outils MCP et fiches de démarche.
L'ancien périmètre GET/PUT avec provisioning initial ne répondait pas à un besoin
métier justifiant cette restriction. Cette extension de l'API ne dépend pas de la
mise à jour du frontend. Les fiches décrivent les démarches ; ce ne sont pas les
dossiers personnels des usagers.

| Action | Route | Résultat |
|---|---|---|
| Créer | `POST /v1/admin/{models,tools,procedures}` | 201, ressource complète |
| Lister | `GET /v1/admin/{models,tools,procedures}` | 200, page `items`/`nextCursor` |
| Lire | `GET /v1/admin/{models,tools,procedures}/{id}` | 200, ressource complète |
| Remplacer | `PUT /v1/admin/{models,tools,procedures}/{id}` | 200 ; aucune création implicite |
| Supprimer | `DELETE /v1/admin/{models,tools,procedures}/{id}` | 204, sans corps |

## Identité et validation

JWT administrateur, administration du jeton et `traceparent` valides requis.
GET exige `admin:read`, mutations `admin:write`. Une administration ne peut lire,
modifier ou supprimer les entrées d'une autre (404). Le même identifiant de modèle ou nom d’outil est
utilisable dans deux administrations sans collision. Les identifiants de fiches
restent globalement uniques : l’API privée de ressources Tooling les référence
sans administration. Un POST avec un identifiant de fiche déjà utilisé donne
409, y compris depuis une autre administration, sans exposer la fiche. Le corps complet POST/PUT
suit `ModelConfig`, `ToolConfig` ou `Procedure` : `id` pour modèle/fiche, `name`
pour outil. PUT exige une correspondance avec l'identifiant de route.
Les propriétés non prévues sont refusées. DELETE n'attend aucun corps.

L'administration de la fiche doit correspondre au jeton et son `formSchema` doit
être compilable. Les URLs MCP restent soumises à l'allowlist du déploiement ;
`secretRef` est une référence, pas un secret. Ajouter un modèle n'installe ni un
fournisseur ni un prompt : le fournisseur et la version de prompt doivent être
supportés par le runtime. Ajouter un outil ne l'implémente pas sur le serveur MCP.

## Reprises et suppressions

POST/PUT/DELETE exigent `Idempotency-Key` de 8 à 128 caractères. Une même clé,
acteur, administration, méthode, ressource et ID rejoue le succès pendant 24 h
sans nouvelle écriture ni nouvel audit. Un contenu différent donne 409
`IDEMPOTENCY_CONFLICT`. POST sur un ID existant donne 409 `INVALID_TRANSITION`.
PUT/GET/DELETE sur une entrée absente donnent 404.

Exemple : supprimer un modèle, le recréer, puis rejouer l'ancienne suppression
avec sa clé initiale retourne 204 et **conserve le modèle recréé**. Employer une
nouvelle clé pour une nouvelle intention de suppression.

La suppression retire uniquement la configuration. Elle ne supprime ni dossiers,
ni fichiers, ni consentements, ni historique. Une fiche référencée par les
projections locales de demandes, mandats ou challenges est protégée par 409
`INVALID_TRANSITION`. Cette protection ne garantit pas la connaissance de toutes
les références du Tooling : la livraison des événements est asynchrone et aucun
accès SQL à l'autre service n'est effectué. Éviter la suppression d'une fiche en
cours d'utilisation ; la conserver et la modifier plutôt que casser son catalogue.
La vérification de références et les écritures des autres services ne constituent
pas une transaction distribuée.

Supprimer le dernier modèle actif ou un outil nécessaire est possible et peut
rendre les nouveaux traitements indisponibles. Préparer une configuration de
remplacement avant suppression. La protection opérationnelle existante exige
exactement un modèle actif ; elle ne choisit pas arbitrairement parmi plusieurs.
Un traitement ayant déjà chargé sa configuration peut continuer avec celle-ci.

Chaque mutation réussie ajoute atomiquement un événement `configuration.changed`
avec `operation: created | updated | deleted`. Le champ est facultatif pour lire
les anciens événements. Le GET audit expose `configuration.changed.created`,
`.updated` ou `.deleted` pour ces nouvelles entrées, sans contenu de configuration
ni secret dans l'événement.

## Vérifier dans Swagger

Dans le contrat **Administration**, se connecter comme administrateur. Copier un
exemple GET en changeant son `id`/`name`, puis POST avec une nouvelle clé. Vérifier
GET détail, modifier avec PUT et une autre clé, puis DELETE et une troisième clé.
GET détail doit alors donner 404 ; rejouer DELETE avec sa clé retourne 204.
Réutiliser cette recette pour les modèles et fiches ; pour MCP, suivre le guide des connexions et permissions. Ne pas employer une fiche liée
à un dossier existant pour ce test de suppression.

Validation automatisée : `pnpm --filter @techma/backend test` couvre le vrai
PostgreSQL, JWT, isolation, création concurrente, rejeux, conflits, références
et audit. `pnpm test` vérifie aussi les nouvelles opérations des mocks contractuels.
