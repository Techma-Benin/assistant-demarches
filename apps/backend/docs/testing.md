# Tester le Backend dans Swagger

Pour les nouvelles fonctions du pivot (départements, utilisateurs, dossiers, KPI, documents et interventions humaines), commencer par `docs/backend-pivot-recette.md` à la racine du dépôt. Le présent guide détaille le socle conversationnel ; les contrats actuels du pivot et ses dépendances interéquipes sont décrits dans `docs/backend-pivot-api.md`.

Swagger est un client HTTP : il envoie de vraies requêtes au Backend et peut modifier la base configurée. Les exemples sont des données fictives ; ils ne créent pas automatiquement les ressources auxquelles ils font référence.

## Test local sans chercher de jeton

Pour les essais locaux, activer `BACKEND_DEV_AUTH=true` dans le `.env` puis lancer `pnpm dev`. En haut de `/docs`, cliquer **Tester comme usager** avant les routes de conversation, ou **Tester comme administrateur** pour les routes admin. Le bouton génère la connexion de test : rien à copier dans Authorize. Les en-têtes techniques laissés aux valeurs d’exemple sont remplacés automatiquement par des valeurs uniques lors de l’envoi. Une valeur personnalisée reste conservée pour tester les rejeux.

Les identités de test sont signées et expirent après 8 h ; relancer `pnpm dev` puis se reconnecter si elles expirent. Les données écrites restent dans la base locale. Le même usager de test retrouve ses conversations après redémarrage, mais les anciens jetons ne sont plus valides. Ces identités sont limitées à `pnpm dev` et à une écoute locale ; elles ne remplacent pas Keycloak pour une intégration réelle. Aucun modèle ni worker n’est lancé par ce bouton.

## Commencer ici

1. Depuis la racine du dépôt, lancer `pnpm dev`. Le `.env` est chargé et les migrations sont appliquées. Ouvrir `/docs`.
2. Vérifier `GET /health` dans le navigateur : `{"status":"ok","service":"backend"}` signifie que l’API et les migrations répondent. Cela ne vérifie pas le modèle, Redis, Keycloak ni les autres équipes.
3. Choisir un contrat dans **Select a definition** : `conversation` pour le parcours usager, `admin` pour la configuration opérateur, `department-admin` pour la console métier, `events` et `backend-resources` pour les appels du Tooling. `tooling-admin` décrit les commandes à implémenter sur le serveur Tooling, pas des routes locales du Backend.
4. Cliquer **Authorize**, saisir uniquement le JWT, puis confirmer. Swagger ajoute `Authorization: Bearer …`. Les jetons ne sont pas persistés après rechargement. Déconnecter l’ancien jeton avec **Logout** avant de changer de rôle.
5. Déplier une route, lire ses prérequis, cliquer **Try it out**, remplir les paramètres, puis **Execute**. La section **Server response** est la réponse réelle ; les exemples de la section **Responses** ne prouvent pas qu’un appel a eu lieu.

## Ce qui fonctionne selon les services disponibles

| Parcours | Prérequis |
| --- | --- |
| Consulter Swagger | API démarrée |
| Vérifier `/health` | PostgreSQL accessible, migrations appliquées |
| Créer une conversation, envoyer un message, lire ses événements | PostgreSQL + JWT usager valide + fournisseur d’identité joignable pour vérifier sa signature |
| Obtenir une réponse IA | Prérequis précédents + worker + Redis + un seul modèle actif pour l’administration, fournisseur et prompt configurés ; MCP et identité de service pour les outils utilisés |
| Lire/modifier la configuration | JWT administrateur avec `administrationId` et `admin:read` ou `admin:write` ; ressources déjà provisionnées pour PUT |
| Autoriser/révoquer un mandat | Conversation + fiche validée + clé de signature et service de contrôle Tooling configurés |
| Utiliser une pièce jointe | Stockage ; pièce disponible dès le dépôt, worker requis pour la purge à expiration |
| Appels internes | JWT de service dédié, ressources existantes et cohérentes |

**État du démarrage local :** la configuration PostgreSQL ne fournit pas de JWT et ne déploie ni Keycloak, ni Redis, ni un modèle, ni le Tooling. `pnpm dev` lance l’API ; le worker est un processus séparé. Si l’identité n’est pas configurée, le parcours authentifié s’arrête avant la première conversation. En dehors du mode de test local décrit plus haut, aucun jeton de démonstration universel n’est livré ; `mock-user` et `mock-admin` ne fonctionnent qu’avec le serveur de simulation.

Lancer le worker depuis la racine après compilation :

```sh
node --env-file=.env apps/backend/dist/apps/backend/src/worker.js
```

## Quel jeton utiliser ?

Le jeton provient du fournisseur d’identité configuré par `OIDC_ISSUER` et `OIDC_JWKS_URL`, via le parcours du portail/Interface. Utiliser son **access token**, pas son ID token. Le Backend n’a pas d’endpoint de connexion ni d’émission de jetons. La configuration du realm et des clients doit être disponible avant les tests manuels ; Swagger ne remplace pas cette étape.

Tous les JWT doivent être signés en RS256, non expirés, porter un `sub`, un `iss` conforme et l’audience `techma-backend`. Ne pas fabriquer un JWT en recopiant un JSON : il doit être signé par une clé approuvée.

| Contrat | Identité et droits |
| --- | --- |
| Conversation web/mobile | Identité usager du portail, sans scopes `admin:*`. Le Backend contrôle le propriétaire de chaque conversation. Utiliser le même usager pendant le scénario. |
| Conversation WhatsApp | Relais `whatsapp-adapter`, scope `conversation:relay` et claim signé `channel_subject` E.164. Le relais est géré par l’équipe Interface ; aucune saisie du numéro dans le corps de création. |
| Admin GET | `administrationId` et scope/rôle `admin:read`. |
| Admin POST/PUT/DELETE | `administrationId` et scope/rôle `admin:write`. |
| Events | Client `tooling-events`, scope `events:publish`. |
| Backend resources | Client `tooling-resources`, scope `resources:read`. |

Le nom de client est lu dans `azp` ou `client_id`. Les scopes peuvent aussi provenir des rôles signés `realm_access.roles`. Un jeton administrateur ne sert pas à simuler un usager. L’identité technique requise par l’API n’implique pas qu’un écran de connexion soit présenté dans WhatsApp.

## Paramètres communs

- **traceparent** : identifiant technique de traçage, requis sur les routes API. Pour un essai manuel : `00-12345678901234567890123456789012-1234567890123456-01`. Utiliser de nouvelles valeurs pour tracer des essais distincts ; aucune donnée personnelle dans ce champ.
- **Idempotency-Key** : 8 à 128 caractères. Choisir une nouvelle clé pour une nouvelle opération, par exemple `manual-create-001`. Pour rejouer exactement la même opération, conserver la même clé et le même corps. Changer le corps en gardant la clé peut produire un `409`. Une clé par route est préremplie comme point de départ ; la changer entre essais indépendants.
- **Identifiants** : reprendre les valeurs réellement retournées par l’API. Les `cnv_…`, `req_…`, `fil_…`, `chl_…` et `mdt_…` des exemples sont fictifs et produiront généralement un `404`/`403` s’ils sont copiés tels quels.
- **cursor** : laisser vide au premier appel ; ensuite recopier `nextCursor`, sans le modifier.
- **limit** : taille d’une page d’administration, de 1 à 100, 20 par défaut.
- **PUT** : envoyer la ressource complète. Ce n’est pas un PATCH et cela ne crée pas une ressource absente. Faire un GET, copier l’objet réel, modifier les champs souhaités, puis PUT avec son identifiant.

## Scénario 1 — Une conversation texte

1. Avec un JWT **usager**, appeler `createConversation` avec `{"channel":"web","locale":"fr"}`. Attendre **201**. Copier `id` dans `conversationId` des appels suivants.
2. Appeler `sendMessage` avec cette conversation, une nouvelle clé d’idempotence et l’exemple texte proposé. Pour chaque nouveau message, changer aussi `id` : format `msg_` suivi de 26 caractères ULID, par exemple `msg_01ARZ3NDEKTSV4RRFFQ69G5FAV`. Mettre une date ISO dans `sentAt`.
3. Attendre **202** et `status: accepted`. Cela signifie que le message est enregistré, pas que l’agent a répondu.
4. Appeler `listConversationEvents`, sans curseur au début. Chercher `bj.techma.message.received.v1`, puis `bj.techma.message.sent.v1`. Relancer avec `nextCursor` pour les nouveaux événements. Si le worker/modèle n’est pas configuré, aucune réponse IA ne peut être garantie.
5. Pour le temps réel, demander `createSocketTicket`. Dans un client WebSocket, ouvrir directement l’URL retournée, qui contient déjà `ticket` ; ajouter éventuellement `&cursor=<nextCursor>`. Le ticket est court et à usage unique ; l’en-tête Origin doit figurer dans `CORS_ALLOWED_ORIGINS`. Swagger HTTP n’ouvre pas la connexion WebSocket.

Les événements sont conservés 48 h. Un curseur expiré retourne `410` : reprendre sans curseur pour relire la fenêtre encore conservée. Un message `STOP` suspend immédiatement les nouvelles actions locales ; sa révocation des mandats nécessite le worker et le contrôle Tooling.

## Scénario 2 — Configuration des modèles, outils et fiches

Passer au contrat `admin` et à un JWT administrateur. Commencer par les GET ; une liste vide signifie qu’aucune configuration n’a été provisionnée pour cette administration.

Pour modifier : copier un objet retourné par GET, utiliser son `id` (ou `name` pour un outil) dans le chemin PUT, modifier l’objet complet et fournir une nouvelle clé d’idempotence. Attendre **200**, puis refaire GET. Créer avec `POST /v1/admin/{models,tools,procedures}` (201), identifiant `id` dans le corps (`name` pour un outil). Lire ensuite le GET détail. Supprimer avec DELETE détail (204 sans corps), sans effacer les dossiers ou l’audit. Chaque mutation demande une nouvelle clé ; rejouer la même clé pendant 24 h ne reproduit pas la mutation, y compris après une recréation. Une fiche référencée par demandes/mandats/challenges locaux est protégée par 409 ; les références Tooling non encore projetées ne sont pas détectables. Supprimer le dernier modèle actif ou un outil requis peut rendre les nouveaux traitements indisponibles. Voir `docs/admin-crud.md` dans le dépôt.

Un modèle enregistré n’est pas nécessairement joignable : `provider` doit correspondre à `MODEL_PROVIDERS_JSON`, `model` à un identifiant disponible chez le fournisseur, `promptVersion` à un prompt installé. Un seul modèle actif est requis par administration. Les modifications affectent les nouveaux traitements.

Un outil doit appartenir au catalogue v1. Son `serverUrl` doit être autorisé dans `MCP_ALLOWED_URLS` et `secretRef` doit être résolu côté serveur. Ne jamais mettre un secret ou une clé API dans `secretRef` : c’est un nom de référence. Une fiche n’est exposée au Tooling qu’après `validationStatus: validated`.

## Scénario 3 — Consentement et suivi de demande

1. Préparer une conversation usager et récupérer l’identifiant d’une fiche validée.
2. Appeler `createMandateChallenge` avec cet identifiant et les scopes nécessaires. Attendre **201**, lire `consentText`, conserver `id` et `expiresAt`. Le challenge expire après 5 minutes dans cette implémentation.
3. Seulement après un accord explicite, appeler `grantMandate` avec `{"challengeId":"<id retourné>","accepted":true}`. Attendre **201** et conserver le mandat retourné. Une saisie de code SMS n’a pas lieu ici : la vérification officielle reste sur le portail administratif.
4. Pour retirer l’autorisation, appeler `revokeMandate` avec la conversation et le mandat réels. Attendre **200**. Le contrôle Tooling doit être disponible.
5. Quand un outil ou un événement a créé une demande, récupérer son `requestId` depuis les événements, puis appeler `getRequest`. La création d’une conversation ne crée pas de demande administrative.

Sans clé de signature ou service de contrôle disponible, ces opérations peuvent renvoyer `503`. Ne pas modifier le prompt pour contourner le consentement.

## Scénario 4 — Fichier

Dans `uploadFile`, choisir un fichier binaire, utiliser `application/octet-stream` pour le corps et indiquer le MIME d’origine dans `X-File-Mime-Type` parmi les valeurs autorisées affichées. Maximum : 10 Mio. Attendre **201** et conserver `id`.

Le fichier est utilisable dès le dépôt réussi, sans analyse antivirus ni analyse du contenu. Un fichier expiré ou appartenant à un autre usager ne peut pas servir de pièce jointe. Il expire après 24 h. Pour le référencer dans un message, utiliser `{"type":"file","fileId":"<id réel>"}` comme `content` (et renseigner `id`, `sentAt` du message). L’upload seul n’ajoute pas le fichier à une conversation. L’API v1 ne fournit pas de GET public de statut fichier ; la lecture interne nécessite l’identité Tooling. La transcription d’un message `audio` exige l’activation et la configuration explicites de l’adaptateur du pivot. Les images et PDF ne déclenchent aucun OCR ni transcription.

## Scénario 5 — Intégration Tooling

Ces routes ne sont pas des opérations utilisateur ou administrateur. Utiliser des JWT de service distincts.

- `events` : le Tooling publie des événements de demande/mandat avec les vrais identifiants de conversation et de propriétaire. Un **202** confirme l’ingestion ; les répétitions sont dédupliquées. Une incohérence de propriétaire est refusée. L’exemple est un gabarit synthétique à adapter à un scénario existant.
- `backend-resources` : chercher une fiche validée par titre (`query`), lire une fiche par identifiant, ou lire les métadonnées d’un fichier avec `fileId` et `X-User-Ref` de son propriétaire. Une recherche vide ne justifie pas d’inventer des identifiants.

## Comprendre les erreurs

| Code | Vérification à faire |
| --- | --- |
| 400 | JSON, champs obligatoires, format d’identifiant et `traceparent`. Lire `detail` dans la réponse. |
| 401 | JWT absent/expiré/invalide, mauvais issuer/audience/signature ou mauvaise identité de service. |
| 403 | Mauvais rôle, propriétaire, canal ou challenge expiré. |
| 404 | Ressource absente, non visible ou fiche non validée ; utiliser un identifiant réel. |
| 409 | Clé d’idempotence réutilisée avec un corps différent ou conflit métier. |
| 410 | Curseur de relecture expiré ; reprendre sans curseur. |
| 413 / 415 | Fichier trop gros / format de corps ou MIME non pris en charge. |
| 503 | Dépendance, identité distante, stockage, signature ou configuration indisponible ; lire `detail` et les logs serveur. |

Si Swagger affiche « Failed to fetch » sans réponse HTTP, vérifier le serveur, l’URL et les règles CORS. **Authorize** ne teste pas la validité du jeton : seul un appel API la vérifie.

## Administrer des serveurs MCP

Dans le contrat admin, groupe Serveurs MCP : ajouter une connexion (`McpServer`), lancer discover, puis activer les actions souhaitées via PUT permission. Les noms et schémas viennent du serveur. La connexion peut être désactivée ou supprimée ; les actions se désactivent individuellement. Les anciennes routes Outils MCP sont dépréciées. Documentation détaillée : `docs/mcp-connections.md` à la racine du dépôt.
