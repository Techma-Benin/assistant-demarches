# Backend du pivot : intégration Interface / Tooling

État : 30 octobre 2026. Branche `backend/department-pivot`, manifeste de contrats **1.3.0**.
Sources fonctionnelles : compte rendu de l'appel et PowerPoint du 29 octobre, partagés par les trois équipes.

## Responsabilités

Le Backend porte les conversations, l'agent, le consentement, le stockage privé et les projections de la console. Tooling reste la référence du catalogue, des dossiers, du paiement et des décisions administratives. La projection Backend ne crée aucune décision administrative. Les services de l'État et les paiements réels ne sont pas raccordés par cette livraison.

L'annuaire local (`AdminDirectory`) est un **adaptateur de démonstration** pour les profils, départements et affectations. Il permet de tester les droits maintenant ; il devra être remplacé/raccordé à l'annuaire simulé de Tooling lorsque son API sera disponible. OIDC reste la référence d'identité. Ne pas maintenir simultanément deux annuaires autoritatifs.

## Contrats et documentation

- `contracts/v1/department-admin.openapi.json` : nouvelles routes métier de la console.
- `contracts/v1/tooling-admin.openapi.json` : commandes Backend → Tooling.
- `contracts/v1/events.openapi.json` + `domain.schema.json` : snapshots C4.
- `conversation.openapi.json` : suivi structuré et téléchargement usager.
- `backend-resources.openapi.json` : transfert privé des pièces et documents délivrés.
- Types générés dans `packages/contracts-ts/src/department-admin.ts` et `tooling-admin.ts`.
- Swagger : `/docs`, spécifications `/docs/openapi/department-admin.json` et `/docs/openapi/tooling-admin.json`.

Les anciennes routes restent disponibles. Les clients doivent régénérer leurs types : `blocked` est un nouvel état, `audio/webm` un nouveau format vocal, `request.snapshot` un nouvel événement **interne**, jamais une nouvelle frame publique de conversation. Cette évolution demande intégration coordonnée des trois équipes ; le dépôt de cette branche ne prétend pas constituer leur approbation.

## Identité et droits

Toutes les routes exigent un JWT OIDC RS256 valide pour l'audience `techma-backend`, `traceparent` et HTTPS hors localhost. Les mutations exigent `Idempotency-Key` (8–128 caractères). Aucun mot de passe n'est géré par l'API Backend.

| Identité / permission | Portée |
|---|---|
| Affectation `agent` à un département | Lire et traiter les dossiers de ce département |
| Affectation `admin` | Même accès + gérer les affectations de ce département |
| `admin:super` | Tous les départements et gestion de l'annuaire ; aucun droit technique implicite |
| `operator:read` / `operator:write` | Configuration modèles/MCP séparée du travail métier |

Dès qu'un sujet est inscrit dans l'annuaire, sa désactivation et ses affectations en base font autorité, même si son JWT n'a pas expiré. Les claims `admin:super` ajoutés à son JWT ne peuvent pas élargir ses droits. Pour un opérateur inscrit, les scopes OIDC dédiés et la colonne serveur `backend_admin_users.operator_permissions` doivent autoriser la même opération ; cette colonne ne s'édite pas dans les corps HTTP métier.

Compatibilité transitoire : avant inscription seulement, un `administrationId` et des scopes `admin:read/write` signés conservent l'accès aux anciennes routes de configuration, pour ce département. Les nouveaux agents métier ne doivent pas recevoir ces anciens scopes. Pour les configurations, un acteur à plusieurs départements sélectionne explicitement `X-Administration-Id`.

En développement local avec `BACKEND_DEV_AUTH=true`, le bouton administrateur de Swagger fournit les droits d’amorçage du pivot, uniquement sur loopback. Ce mode ne remplace pas la session OIDC réelle.

Le super administrateur initialise les départements puis les utilisateurs avec les routes ci-dessous. Une identité avec `admin:super` signée peut amorcer l'annuaire ; dès son inscription, ses droits enregistrés s'appliquent. Les identités de test ne doivent jamais servir en production.

## Annuaire et profil

| Route | Utilisation |
|---|---|
| `GET /v1/admin/me` | Profil, permissions effectives et départements accessibles |
| `PUT /v1/admin/me` | Profil d'un sujet déjà inscrit ; `revision` obligatoire |
| `GET /v1/admin/departments` | Départements accessibles, pagination |
| `POST /v1/admin/departments` | Création par super administrateur |
| `PUT /v1/admin/departments/{id}` | Modification avec `revision` |
| `GET /v1/admin/users?departmentId=…` | Utilisateurs visibles et affectations autorisées |
| `POST /v1/admin/users` | Inscription et affectations explicites |
| `PUT /v1/admin/users/{subject}` | Modification avec `revision` ; interdiction d'élargir ses propres droits |
| `DELETE /v1/admin/users/{subject}` | Désactivation logique ; un admin local ne retire que ses propres affectations |

`/me` peut présenter une identité signée non inscrite (`revision: 0`), mais sa modification renvoie `409 DIRECTORY_ENROLLMENT_REQUIRED` avant inscription. Une photo est une URL HTTPS validée ; son hébergement n'est pas fourni ici. Les comptes partagés entre départements ne sont pas modifiables globalement par un admin local. Le dernier super administrateur actif est protégé.

## Console métier

`departmentId` est facultatif uniquement si l'agent ne possède qu'un département. Un super administrateur choisit explicitement le département ; les vues globales s'obtiennent en consultant les départements autorisés. Les curseurs sont opaques.

| Route | Réponse / comportement |
|---|---|
| `GET /v1/admin/work-items?departmentId=…&status=pending` | Dossiers déposés `submitted`, `processing`, `blocked` |
| Même route avec `status=completed`, `draft`, `all` | Dossiers terminés, brouillons ou tous ; `limit` 1–100 |
| `GET /v1/admin/work-items/{id}` | Dossier autorisé, données structurées et provenance ; aucun texte de chat |
| `POST /v1/admin/work-items/{id}/actions` | Intervention humaine transmise à Tooling |
| `GET /v1/admin/work-items/{id}/documents/{fileId}` | Téléchargement privé d'un document référencé et non expiré |
| `GET /v1/admin/dashboard?departmentId=…&from=…&to=…` | KPI sur les dossiers déposés dans `[from,to[`, défaut 30 jours, maximum 366 jours |
| `GET /v1/admin/activity?departmentId=…` | Actions appliquées ou événements anciens ignorés, IDs et trace, sans données de dossier |
| `GET /v1/admin/unanswered?departmentId=…` | IDs de demandes non répondues, motif et état, sans contenu conversationnel |
| `POST /v1/admin/unanswered/{id}/resolve` | Marquer résolu ; les questions sans département exigent un super administrateur |

Les KPI comptent des **dossiers**, pas des conversations : reçus, en attente, bloqués, terminés, terminés par l'IA, rejetés, en retard, médiane de traitement, répartition par canal et démarches les plus demandées. Ils sont calculés depuis la projection persistante, indépendamment de l'expiration du replay conversationnel. La période utilise la date de dépôt ; une complétion ultérieure reste comptée dans la cohorte de dépôt choisie.

## Snapshot C4 : livrable attendu de Tooling

Le client service `tooling-events` (`events:publish`, audience `techma-backend`) publie `POST /internal/v1/events`, comme auparavant, avec un événement :

```json
{
  "specversion": "1.0",
  "id": "evt_00000000000000000000000001",
  "source": "urn:techma:tooling",
  "type": "bj.techma.request.snapshot.v1",
  "time": "2026-10-30T12:00:00Z",
  "datacontenttype": "application/json",
  "traceparent": "00-11111111111111111111111111111111-2222222222222222-01",
  "data": {
    "kind": "request.snapshot",
    "action": "request.submitted",
    "request": {
      "id": "req_00000000000000000000000001",
      "conversationId": "cnv_00000000000000000000000001",
      "userRef": "usr_00000000000000000000000001",
      "procedureId": "casier-simulation",
      "administrationId": "justice",
      "title": "Casier judiciaire — simulation",
      "status": "submitted",
      "revision": 1,
      "fields": {},
      "fileIds": [],
      "officialLink": null,
      "createdAt": "2026-10-30T12:00:00Z",
      "updatedAt": "2026-10-30T12:00:00Z",
      "submittedAt": "2026-10-30T12:00:00Z",
      "receiptRef": "SIM-RECEIPT-001",
      "simulation": true
    }
  }
}
```

La conversation et son usager doivent déjà exister ; le département doit être actif. Le routage, l'usager et la conversation d'un dossier deviennent immuables. Le snapshot contient le dossier complet, y compris pour une modification des champs ou des pièces **sans changement de statut**.

La révision est un entier strictement croissant par dossier. Même ID d'événement/même contenu : rejeu sans effet. Même révision/contenu différent : 409. Révision plus ancienne : accusée mais ignorée, auditée `ignored_stale`. Les anciennes publications `request.created/status_changed` restent utilisables pour les dossiers legacy ; après adoption des snapshots pour un dossier, Tooling doit publier exclusivement des snapshots pour éviter divergence ou perte de champs.

Un dépôt exige `submittedAt` et `receiptRef`. `blocked` exige `blocking: {code,detail,at}` ; `completed` exige `completedAt` et `completedBy: ai|human`. Un paiement `paid` exige une référence. Ces preuves viennent de Tooling/connecteur ; le modèle n'en invente aucune. `simulation` indique la nature de la démo et doit être conservé dans les interfaces.

Le snapshot peut inclure `payment`, `documents`, `progress` et `evidence`. Le Backend sert ces informations à la console et au panneau usager (`GET /v1/requests/{id}/progress`). Le snapshot interne ne passe pas dans le flux de conversation ; les changements de statut produisent des événements publics nettoyés et une `statusCard`, livrable aussi par le callback WhatsApp existant.

## Intervention humaine Backend → Tooling

Le Backend est client `backend-admin`, audience `techma-tooling`, scope `requests:admin`, distinct du client agent et du contrôle mandat. Configurer `TOOLING_ADMIN_URL` et `TOOLING_ADMIN_CLIENT_SECRET` avec `SERVICE_TOKEN_URL`, ou un jeton de déploiement `TOOLING_ADMIN_TOKEN`.

```http
POST /internal/v1/admin/requests/{id}/actions
Authorization: Bearer <identité de service backend-admin>
Idempotency-Key: <clé stable calculée par le Backend>
traceparent: <trace originale>
```

```json
{"action":"claim","revision":3,"departmentId":"justice","actorRef":"sujet-oidc-de-l-agent"}
```

Le navigateur ne fournit que `action`, `revision` et éventuellement `reason` ; les tentatives de fournir `actorRef` ou `departmentId` sont refusées. Actions : `claim`, `request_information`, `approve`, `reject`, `resume`. Tooling vérifie ses transitions et renvoie le `DepartmentRequest` complet avec une révision supérieure. La nouvelle projection et l'audit sont atomiques côté Backend.

La même clé ne peut exécuter deux actions distinctes. Les commandes concurrentes d'une même révision sont sérialisées. Un journal durable permet de récupérer le résultat Tooling après réponse perdue, avec la même clé distante, même si son événement outbox a déjà actualisé le dossier. Tooling doit conserver ses réponses idempotentes au moins 24 heures. Sans connecteur configuré ou sur réponse invalide, l'API renvoie une erreur explicite et n'invente aucun succès.

**À implémenter par Tooling pour raccorder le pivot** : endpoint de commandes ci-dessus, snapshots sur chaque mutation, transitions de dépôt/paiement/suivi, annuaire distant final et émissions de documents. Le test Backend utilise un serveur HTTP synthétique conforme ; il ne remplace pas cette implémentation.

## Pièces et documents délivrés

Client dédié `tooling-documents`, audience `techma-backend`, scope `documents:transfer` :

- `GET /internal/v1/files/{id}/content`, avec `X-User-Ref` : récupération privée d'une pièce par le connecteur, jamais par le modèle.
- `POST /internal/v1/requests/{id}/documents`, binaire `application/octet-stream`, `X-User-Ref`, `X-File-Mime-Type` et idempotence : stocker un document produit par le service administratif. Retour `File`, à référencer ensuite dans `snapshot.documents`.
- `GET /v1/requests/{id}/documents/{fileId}` : téléchargement usager propriétaire.

PDF/PNG/JPEG pour documents délivrés, 10 Mio maximum. Pièces entrantes : 24 h. Documents délivrés : 30 jours par défaut de démo, paramètre `ISSUED_DOCUMENT_RETENTION_DAYS` (1–365). La conservation du pilote reste à déterminer avec le porteur public. Un fichier stocké mais non publié dans un dossier ne devient pas téléchargeable comme document délivré. Stockage privé, pas de lien public permanent, pas d'analyse du contenu ni garantie antivirus.

## Audio et IA

Voir `backend-pivot-agent.md` pour les garanties et les essais Groq. Activer l'audio uniquement avec `TRANSCRIPTION_ENABLED=true`, `GROQ_API_KEY`, modèle de transcription `whisper-large-v3-turbo` par défaut. Paramètres optionnels : `TRANSCRIPTION_MODEL`, `TRANSCRIPTION_TIMEOUT_MS`, `TRANSCRIPTION_ENDPOINT`, `TRANSCRIPTION_ALLOWED_URLS`, `TRANSCRIPTION_API_KEY_ENV`. Une URL distante personnalisée doit être autorisée explicitement et en HTTPS. Les documents PDF/images ne sont jamais envoyés au service de transcription.

Les données vocales sont traitées par le fournisseur configuré : l'accueil et la politique de confidentialité doivent l'expliquer. Cette livraison ne revendique pas du chiffrement de bout en bout jusqu'au modèle, ni l'absence de traitement par un tiers.

## Démarrage et reprise

1. Lire `backend-pivot-status.md`, vérifier la branche et `git status`.
2. Installer les dépendances verrouillées et générer les contrats.
3. Construire puis appliquer les migrations, notamment `008_admin_directory.sql` et `009_department_work.sql`, avant les nouvelles routes. Ne pas éditer une migration déjà déployée.
4. Configurer l'OIDC, les clients de service, le stockage, PostgreSQL et Redis ; lancer API **et** worker.
5. Initialiser deux départements et les affectations administratives (`pnpm --filter @techma/backend seed ./seeds/demo-deux-bureaux.json`), puis raccorder Tooling aux contrats 1.3.0. Les jetons OIDC de démo doivent utiliser les `sub` `justice-agent`, `enseignement-agent` et `demo-super-admin`.
6. Vérifier le scénario multi-ministères et l'essai Groq explicite avant une démo réelle.

Les identifiants, clés et preuves des tests sont synthétiques. Aucun secret local du dossier parent n'est publié. Le suivi contient les résultats effectifs et les limites restantes ; il prime sur les anciens documents d'avancement du socle.
