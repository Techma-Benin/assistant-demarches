> Pivot du 29 octobre — version 1.3.0 : voir [contrat d’intégration du pivot](docs/backend-pivot-api.md) et les nouveaux OpenAPI `department-admin` / `tooling-admin`. Les anciennes routes ci-dessous restent compatibles pendant la migration. Pour les dossiers passés au snapshot versionné, seuls les snapshots font désormais autorité. Les statuts simulés sont autorisés uniquement avec identification explicite de la simulation et preuves de dépôt/complétion émises par le connecteur de test.

# Contrats d'intégration v1.0.0

Statut : base d'implémentation exécutable, proposée à la revue des trois groupes. Les équipes peuvent commencer leurs adaptateurs, leurs modules et leurs tests sur cette base ; aucun accord collectif fictif n'est présumé. Les évolutions passent par PR avant changement d'une frontière. Pas de promesse d'intégration sans tests : chaque vrai service doit passer la même suite sur ses URL.

## 1. Sources de vérité

| Contrat | Source machine | Producteur → consommateur |
|---|---|---|
| C1 Conversation | `contracts/v1/conversation.openapi.json` | Backend → Interface |
| C2 outils | `contracts/v1/mcp.tools.json` | Tooling → Backend |
| C2 contrôle mandat | `contracts/v1/tooling-internal.openapi.json` | Tooling → code de consentement du Backend |
| C3 Administration | `contracts/v1/admin.openapi.json` | Backend → console Interface |
| C4 événements | schéma `Event` dans `domain.schema.json`, `events.openapi.json` | Tooling → Backend → canaux |
| Données communes | `contracts/v1/domain.schema.json` | Tous |

Les fichiers OpenAPI sont du JSON valide en version 3.1 ; tous les corps, codes de succès et types sont décrits. Les schémas MCP sont embarqués sans référence externe pour être directement utilisables. Les types C1/C3/C2-interne/C4 se génèrent depuis OpenAPI. Toute modification des schémas communs doit être répercutée dans les documents embarqués ; `contracts:check` contrôle leur cohérence.

## 2. Règles communes

- Champs et code en anglais, messages d'interface en français. Aucun champ inconnu dans les objets fermés.
- Identifiants préfixés suivis de 26 caractères Crockford ULID ; générés par le propriétaire. Dates ISO 8601 UTC. Montants FCFA entiers. `fr`, `fon`, `yo` sont les locales acceptées ; disponibilité effective du vocal français à démontrer, autres langues en phase ultérieure.
- `traceparent` W3C obligatoire sur tout appel, y compris MCP ; format v00. Ne jamais accepter trace/span entièrement nuls en production. `traceId` = ses 32 caractères de trace.
- `Authorization: Bearer …` sur chaque frontière. HTTPS obligatoire hors localhost. CORS limité aux origines du portail/configuration ; pas de `*` avec credentials.
- `Idempotency-Key` de 8 à 128 caractères sur POST/PUT, y compris révocation et appel MCP d'action. Conservation minimale 24 h. Portée = identité authentifiée + méthode + route + clé. Même payload → même statut/corps ; autre payload → 409. Les traitements concurrents doivent partager la même promesse/réservation atomique. Pas de nouvel effet sur rejeu, même si le statut du mandat a évolué.
- `message.id` assure aussi la déduplication des webhooks. Même ID avec contenu différent → 409 ; pas de nouveau message agent pour le même message entrant.
- Réponse synchrone HTTP confirmant seulement l'acceptation : 202. L'agent répond par événements. Aucun navigateur ni adaptateur WhatsApp ne contient de logique IA.
- Un service est seul propriétaire de ses tables ; aucun accès SQL croisé. Les données de pièces sont référencées par `fileId`, jamais incluses dans le contexte du modèle.

## 3. Identités et permissions

Profil de production commun : JWT RS256, issuer = realm Keycloak du déploiement, JWKS configuré par variable d'environnement. Vérifier signature, algorithme, issuer, audience, `exp`, `nbf` avec 30 s de tolérance maximum. Audience Backend = `techma-backend`, audience Tooling = `techma-tooling`. Environnements isolés ; aucun jeton statique des mocks hors localhost.

| Identité | Droits |
|---|---|
| Usager portail | `sub` lié côté serveur à `userRef` ; accède uniquement à ses conversations, fichiers, demandes et mandats |
| Adaptateur WhatsApp | client service `whatsapp-adapter`, droit `conversation:relay` ; Backend résout l'usager à partir du numéro normalisé et vérifié par la signature Meta. Le numéro est transporté en claim signé `channel_subject` dans un jeton d'échange, jamais en argument modèle. |
| Administrateur | `admin:read` ou `admin:write`, claim `administrationId` ; accès aux seules fiches/conversations de cette administration, filtrage serveur |
| Agent Backend | client `backend-agent` vers `/mcp`, scope `tools:call` ; **aucun** accès au contrôle mandat |
| Contrôle Backend | client `backend-mandates`, scope `mandates:grant`, seul accès aux routes internes de mandat |
| Événements Tooling | client `tooling-events`, scope `events:publish`, seul accès à l'ingestion C4 |

Le Backend ne fait jamais confiance à un `userRef` fourni par le navigateur ou par le modèle. Les endpoints C1 ne le prennent donc pas en entrée. Au niveau Tooling, les en-têtes de contexte ne sont acceptés que d'un client `backend-agent` authentifié ; ils sont construits par du code applicatif hors modèle. Vérifier aussi la propriété des ressources, la conversation et la portée du mandat côté Tooling.

Session du widget : le portail échange sa session signée auprès du Backend / fournisseur OIDC pour un jeton usager à durée courte. Ce provisioning OIDC est de l'infrastructure, pas une nouvelle méthode d'authentification inventée par le widget. WhatsApp : l'adaptateur vérifie Meta, déduplique et acquitte rapidement ; le traitement long est mis en file.

## 4. C1 : début de conversation et messages

1. `POST /v1/conversations` avec `channel`, `locale` → 201 `Conversation` ; l'usager vient du jeton.
2. `POST /v1/files` si nécessaire : corps binaire `application/octet-stream`, `X-File-Mime-Type` obligatoire, 10 Mio maximum, pas de multipart en v1. Retour 201 `File` sans URL publique. Pièce utilisable dès le dépôt réussi, sans analyse antivirus ni analyse du contenu. Durée de conservation par défaut 24 h dans la démo ; politique pilote à faire valider.
3. `POST /v1/conversations/{conversationId}/messages` avec `MessageInput` → 202 `MessageAccepted`.
4. Réception `message.sent` contenant `AgentMessage.blocks` : `text`, `buttons`, `form`, `fileRequest`, `statusCard`. Les canaux rendent ces mêmes blocs selon leurs possibilités ; un formulaire WhatsApp se déroule en échanges successifs.
5. `GET /v1/requests/{requestId}` renvoie le dernier statut connu, en contrôlant l'usager.

`sentAt` vient du canal ; le serveur conserve aussi son heure de réception. Un `fileId` appartient à l'usager et doit être non expiré. L'agent reçoit uniquement une référence opaque, jamais le contenu brut ; aucune transcription/OCR n'est implémentée.

Toute affirmation administrative dans un bloc texte porte au moins une `Source` (URL, identifiant, version et date). Une explication de fonctionnement, un refus ou un message conversationnel peuvent avoir `sources: []`. Le modèle refuse de donner une information administrative sans source ; le schéma seul ne peut pas juger cela, les évaluations le doivent.

## 5. Retour asynchrone : web et WhatsApp

Le journal d'événements de conversation est la référence pour la reprise. Livraison au moins une fois ; tous les consommateurs dédupliquent `Event.id`. Ordre conservé **par conversation**, pas d'ordre global. Rétention/rejeu au moins 24 h. `cursor` est l'ID du dernier événement traité ; 410 `REPLAY_EXPIRED` s'il est inconnu/expiré.

- Web/mobile : `POST /v1/conversations/{id}/socket-ticket` → ticket à usage unique, durée 60 s, URL WS. Connexion sur cette URL avec `&cursor=evt_…` si reprise. Après ouverture, le serveur pousse un objet `Event` JSON par frame texte, puis les nouveaux événements. Pas de token usager dans l'URL, ne jamais journaliser le ticket. Ping/pong toutes les 30 s ; reconnexion avec délai 1/2/4/…/30 s et nouveau ticket. Les tickets n'étendent pas la durée du jeton usager. Origin du portail vérifiée à l'upgrade en production.
- Repli et tests : `GET /v1/conversations/{id}/events?cursor=…` → `EventPage`, au plus 100 événements. `nextCursor` = dernier retourné, ou curseur d'entrée si aucune nouveauté. Répéter après 1 s en absence de socket. Aucun double affichage après reprise.
- WhatsApp : rappel HTTP `POST` vers **une URL configurée et autorisée au déploiement**, jamais fournie par l'usager ou le modèle. Corps = même `Event` C4, événement `message.sent` seulement. Auth service `backend-delivery`, audience `whatsapp-adapter`, scope `messages:deliver`, plus `traceparent`. L'adaptateur stocke l'ID et répond 204 avant l'envoi Meta en file ; les doublons répondent aussi 204. Le Backend réessaie après 1/2/4/…/60 s pendant 24 h puis file d'échec ; 401/403 déclenchent une alerte et une correction de configuration.

Le rappel WhatsApp est spécifié dans `contracts/v1/whatsapp-callback.openapi.json`. Le serveur mock Backend expose le flux WS et le polling ; le récepteur de rappel fait partie de l'adaptateur Interface à construire et possède son test dédié dans la suite.

## 6. Consentement et mandat

1. Backend présente les scopes, la démarche, la durée et le texte de consentement via `POST …/mandate-challenges` → `Challenge` valable 5 minutes, à usage unique.
2. L'Interface affiche **le texte du serveur** et relie le bouton à `challenge.id`. Un message libre « oui » ou une interaction `mandate.accept` ne suffit pas à lui seul ; le Backend vérifie la session, le challenge et l'interaction attendue.
3. Le clic déclenche `POST …/mandates` avec `{challengeId, accepted:true}` ; jamais un appel modèle. Backend transmet la preuve serveur au contrôle interne Tooling : `MandateGrant`, vérifié sous identité `backend-mandates`. Le Tooling valide la cohérence, la durée et l'unicité du challenge signé / enregistré ; le Backend conserve la preuve d'interaction liée au `evidenceRef`. Hors mocks, le JWT `challenge.proofToken` est signé par le Backend et vérifié par le Tooling (RS256, JWKS dédié, audience `techma-mandate`, `jti=challenge.id`, `sub=userRef`, `conversationId`, `procedureId`, `scopes`, `exp=challenge.expiresAt`). Le Tooling compare les claims signés à l’objet transmis et consomme atomiquement le jti. Le token seul ne vaut pas consentement ; le client de contrôle et la preuve d’interaction restent requis.
4. Tooling détient le mandat autoritatif : sujet + conversation + démarche + scopes, expiration 1 h pour la démo. Le modèle reçoit uniquement `mandateId` dans un contexte injecté hors arguments.
5. STOP / bouton de révocation → `POST …/mandates/{id}/revoke`. Backend traduit vers le contrôle Tooling ; effet immédiat sur les nouvelles actions, journalisé. HISTORIQUE expose les propres actions de l'usager via une réponse Backend filtrée, jamais le journal global Admin.

Un challenge signé suffit seulement s'il est appelé par le client contrôle dédié avec preuve d'accord conservée. Une action autorisée ne peut pas élargir les scopes ou renouveler le mandat. Pas de NPI, OTP ou pièces brutes dans les prompts. Le code SMS reste sur le portail officiel.

## 7. C2 : MCP

Transport SDK officiel **Streamable HTTP**, chemin `/mcp`, initialisation MCP standard, version négociée par le SDK. Pas d'endpoint REST `/tools/call` personnalisé.

Chaque requête transporte : `Authorization` agent, `traceparent`, `X-Conversation-Id`, `X-User-Ref`, et `X-Mandate-Id` pour une action. `Idempotency-Key` requis pour chaque `tools/call` d'action. La clé est stable pour la même tentative métier, différente pour chaque opération. Contexte absent du JSON `arguments` et inaccessible au modèle.

Le catalogue garde les annotations MCP standard (`readOnlyHint` etc.). Les règles métier sont dans `_meta` avec clés `bj.techma/kind`, `bj.techma/requiresMandate`, `bj.techma/scopes` ; elles ne sont pas des autorisations : la passerelle les vérifie elle-même.

| Outil | Mandat / scope | Résultat |
|---|---|---|
| `procedures.search` | lecture | liste de fiches |
| `procedures.get` | lecture | fiche complète |
| `request.create` | `requests:write` | demande `draft` |
| `request.update` | `requests:write` | demande actualisée |
| `request.submit` | `requests:submit` | v1 : `awaiting_user_validation` + lien |
| `request.status` | lecture avec contrôle de propriété | demande |
| `documents.attach` | `documents:write` | demande + référence pièce |
| `documents.verify` | lecture, propriété demande et pièce | vérification technique, aucune certification administrative |

Sortie réussie = `structuredContent` conforme à `outputSchema` et bloc texte JSON de même contenu. Erreur métier = `isError: true`, bloc texte JSON `{code, detail, traceId}`. Erreurs de protocole = JSON-RPC MCP standard. HTTP 401/403 pour authentification du transport. Aucun échec d'outil ne doit devenir une réponse réussie fabriquée par le modèle.

`request.update.fields` suit `Procedure.formSchema`, au format JSON Schema 2020-12, sans champs inconnus. Les champs obligatoires peuvent manquer en brouillon mais sont contrôlés avant préparation finale. Pas de données d'identité sensibles dans ces champs v1. Les pièces sont des références opaques ; Tooling valide la propriété et la péremption via `GET /internal/v1/files/{fileId}` avec `X-User-Ref`, identité `tooling-resources`, audience Backend et scope `resources:read`. Réponse `FileAccess` sans contenu brut ni URL publique ; 404 si propriété incompatible. Les fiches sont accessibles via `GET /internal/v1/procedures?query=…` et `GET /internal/v1/procedures/{procedureId}`, même identité. Contrat : `backend-resources.openapi.json`. Seules les fiches validées sont exposées en production ; la simulation utilise une fiche explicitement fictive en brouillon. Dans la démo, fichiers synthétiques uniquement.

Machine d'état : `draft` → `ready` quand champs et pièces requis sont présents → `awaiting_user_validation` en v1. `draft`/`ready` modifiables ; après préparation finale, modification refusée 409. L'absence d'un élément requis donne `REQUEST_INCOMPLETE`. Les états `submitted` → `processing` / `blocked` → `completed` / `rejected` et `cancelled` proviennent de connecteurs ; le pivot autorise un connecteur simulé explicitement identifié (`simulation: true`). Le modèle ne doit jamais les inventer. Le connecteur doit fournir une preuve d'accusé de réception avant passage à `submitted`.

## 8. C3 : administration

Collections `GET /v1/admin/{models,tools,procedures,conversations,audit}` ; métriques par `GET /v1/admin/metrics`. Pagination `cursor`, `limit` (1–100, défaut 20), `nextCursor: null` en fin. Curseurs opaques côté consommateur. Création `POST /v1/admin/{models,tools,procedures}` (201, identifiant dans le corps : `id`, ou `name` pour les outils), lecture unitaire `GET /v1/admin/{models,tools,procedures}/{id}`, suppression `DELETE /v1/admin/{models,tools,procedures}/{id}` (204 sans corps). Mises à jour complètes `PUT /v1/admin/{models,tools,procedures}/{id}` de ressources existantes ; ID corps = ID route. 404 si absent ; 409 si conflit de mise à jour. Pas de PATCH implicite.

POST/PUT/DELETE exigent `admin:write`, `traceparent` et `Idempotency-Key` (8–128 caractères) ; GET exige `admin:read`. Chaque mutation réussie produit atomiquement un événement/audit `configuration.changed` avec `operation` (`created`, `updated`, `deleted`, facultatif pour les anciens événements). POST refuse un ID existant par 409 `INVALID_TRANSITION` ; les IDs de fiches sont globalement uniques (référence dans l’API privée Tooling), ceux de modèles/outils sont propres à l’administration ; PUT ne crée pas. DELETE absent donne 404. Un rejeu avec la même clé pendant 24 h restitue le succès initial sans nouvelle mutation ni nouvel événement, même après suppression/recréation de l’ID ; une autre charge avec la même clé donne 409 `IDEMPOTENCY_CONFLICT`. Les clés sont isolées par administration, acteur, méthode, ressource et ID.

La suppression retire uniquement la configuration ; elle conserve dossiers, consentements et audit. Une fiche référencée par les projections locales demandes, mandats ou challenges de l’administration est protégée par 409 `INVALID_TRANSITION`. Il ne s’agit pas d’une garantie distribuée : les références Tooling non encore projetées ne sont pas connues ; aucun accès SQL croisé n’est ajouté. Conserver/modifier la fiche si des démarches sont en cours. Modèles/outils peuvent être supprimés, y compris le dernier modèle actif : les nouveaux traitements qui en dépendent peuvent alors devenir indisponibles. Le registre des fournisseurs, les serveurs autorisés et les secrets restent des configurations de déploiement ; leur création via C3 n’est pas implicite.

Décision du 28 octobre 2026 : CRUD administratif complet autorisé pour remplacer le périmètre initial GET/PUT provisionné. Le frontend peut adopter ces opérations ultérieurement.

Changement de modèle sans redéploiement. Fiches en brouillon tant que non validées par une administration. La configuration d'outils n'accepte que les serveurs MCP autorisés côté déploiement : `serverUrl` ne permet jamais de contacter une adresse arbitraire. Seules des références aux secrets sont renvoyées. Revue sécurité et événement `configuration.changed` à chaque écriture. Avant pilote, ajouter contrôle de concurrence (ETag/If-Match) avec une évolution documentée ; pour la démo, un administrateur à la fois.

### 8.1 Connexions MCP (décision du 28 octobre 2026)

Le Backend est un client de plusieurs serveurs MCP. L’administrateur crée des **connexions serveur**, pas des définitions d’actions. API canonique : `GET/POST /v1/admin/mcp-servers`, `GET/PUT/DELETE /v1/admin/mcp-servers/{id}`. Corps `McpServer` : `id`, `name`, `url`, `enabled`, `transport: streamable-http`, `auth`, `policy: generic|techma`. Isolation par administration et droits `admin:read`/`admin:write`. CRUD : même idempotence 24 h que les autres configurations.

`POST /v1/admin/mcp-servers/{id}/discover` effectue le vrai `tools/list` MCP paginé. `GET /v1/admin/mcp-servers/{id}/tools` restitue le dernier catalogue découvert (maximum 1 000 actions, sans pagination de cette vue). Noms, descriptions et schémas proviennent du serveur et sont immuables via l’administration. `PUT /v1/admin/mcp-servers/{id}/tools/{toolName}` n’accepte que `{enabled,requiresMandate}`. Découverte et mise à jour de permission sont répétables, sans clé d’idempotence obligatoire ; chaque succès est audité comme une mise à jour. La découverte est possible sur une connexion désactivée.

Les nouvelles actions sont désactivées par défaut, avec mandat requis par défaut ; l’administrateur choisit explicitement si le mandat est nécessaire. Les annotations distantes ne décident pas de cette permission. La politique `techma` impose en plus les règles non désactivables du catalogue métier v1 et valide ses sorties ; `generic` permet les actions hors catalogue avec leurs vrais schémas. Les sorties génériques sont restituables comme résultats de service, sans être promues en fiche validée ou carte de demande Techma. Le mandat local des actions génériques constitue un contrôle préalable de notre application, pas une délégation reconnue automatiquement par le service externe.

Les noms distants identiques sont distingués par un alias modèle stable propre au serveur ; le nom original est conservé pour `tools/call`. Les huit noms Techma historiques sont conservés pour compatibilité ; deux connexions `techma` exposant les mêmes noms ne doivent pas être activées simultanément (utiliser la politique `generic` pour les connexions supplémentaires). Le Backend redécouvre les capacités au traitement et recontrôle connexion/permission immédiatement avant l’appel. Les résultats déjà obtenus et les actions déjà parties ne sont pas annulés par une désactivation. Une modification URL/auth/policy invalide le catalogue local et ses permissions ; une définition distante modifiée est désactivée à la redécouverte avant nouvelle approbation. Suppression en cascade des permissions, conservation de l’audit et des dossiers.

Authentifications prises en charge : aucune (`none`), Bearer par référence (`bearer`), en-têtes nommés par références (`headers`), OAuth serveur-à-serveur `client_credentials` avec secret référencé et endpoint explicite (`oauth-client-credentials`). Les valeurs secrètes ne passent jamais dans C3 ; `MCP_SECRET_REFERENCES` résout les références vers les variables d’environnement. `backend-agent` conserve son identité de service dédiée. Les URL MCP et OAuth doivent être explicitement autorisées dans `MCP_ALLOWED_URLS`, sans redirection. Les identifiants internes usager/conversation/mandat ne sont pas envoyés aux serveurs `generic`.

OAuth interactif Authorization Code + PKCE, découverte automatique OAuth, enregistrement dynamique des clients, `private_key_jwt`, stdio et ancien transport HTTP+SSE ne sont pas implémentés ; leur configuration est refusée, pas simulée. Une plateforme exigeant une identité personnelle déléguée nécessite une évolution dédiée. Détails et sources : [connexions MCP](docs/mcp-connections.md).

Les anciennes routes `/v1/admin/tools` restent **dépréciées** pour les clients historiques. Une migration groupe leurs configurations par administration, URL et référence de secret, conserve les activations et crée une connexion `techma` ; le provisioning historique bénéficie du même pont. Les nouveaux écrans doivent utiliser exclusivement les connexions et permissions. Le catalogue partagé à huit actions reste le contrat du serveur MCP Techma, pas une liste fermée pour les serveurs génériques.

## 9. C4 : événements

CloudEvents 1.0 structuré JSON : schéma commun `Event`. `type` doit correspondre à `data.kind` : `bj.techma.{kind}.v1`. Validation supplémentaire dans `validateEvent` et tests. Source fixe selon service : `urn:techma:backend`, `urn:techma:tooling`, `urn:techma:interface`. `id` stable sur les reprises, `time` = heure de production, trace de la requête d'origine.

Tooling publie vers `POST /internal/v1/events`, sous identité `tooling-events` ; 202 après persistance durable et déduplication de l'ID. Le Backend republie aux canaux autorisés. Transaction + outbox côté producteur ; pas de modification du statut sans événement durable. BullMQ/Redis sert à la livraison/reprise, pas à remplacer la source métier persistée. Même stratégie de reprise que le rappel WhatsApp.

Événements v1 : `message.received`, `message.sent`, `request.created`, `request.status_changed`, `mandate.granted`, `mandate.revoked`, `tool.called`, `configuration.changed`. L’événement `message.received` ne transporte que `messageId` et `conversationId`, sans texte entrant brut. Les données d'événement ne contiennent ni numéro de téléphone, ni NPI, ni pièce, ni texte brut de pièce. Journal d'audit de sécurité séparé, ajout seul, accès Tooling restreint.

## 10. Erreurs HTTP

`application/problem+json` conforme au schéma `Problem` : `type`, `title`, `status`, `detail`, `code`, `traceId`. Pas de stack, secret ou donnée sensible dans `detail`.

| HTTP | Codes |
|---|---|
| 400 | `INVALID_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN`, `MANDATE_MISSING`, `MANDATE_EXPIRED`, `MANDATE_REVOKED`, `MANDATE_SCOPE_DENIED` |
| 404 | `NOT_FOUND` (également ressource d'un autre usager) |
| 409 | `IDEMPOTENCY_CONFLICT`, `REQUEST_INCOMPLETE`, `INVALID_TRANSITION` |
| 410 | `REPLAY_EXPIRED` |
| 413 / 415 | `FILE_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED`, avec `Retry-After` |
| 503 | `UPSTREAM_UNAVAILABLE`, `MCP_AUTH_FAILED`, `MCP_CONNECTION_FAILED`, `MCP_DISCOVERY_FAILED`, avec `Retry-After` |

## 11. Compatibilité et validation

Les schémas existants ne se rétrécissent pas en v1 : ne pas retirer une opération/un champ, rendre un champ requis, changer son type ou retirer un état. Ajouts compatibles en version mineure ; rupture = v2 coexistante, migration annoncée. Les mocks et fixtures évoluent dans la même PR. Les consommateurs doivent tolérer les futurs champs de sortie lorsqu'ils désérialisent ; les producteurs continuent à valider strictement leurs sorties pour leur propre version.

CI : validation OpenAPI / JSON Schema, concordance des schémas embarqués, tests positifs/négatifs, types régénérés sans diff et comparaison des contrats avec la branche cible. Une modification v1 détectée exige une revue explicite et une nouvelle version du manifeste ; la CI ne remplace pas l'analyse humaine de compatibilité.

`CODEOWNERS` désigne actuellement le responsable GitHub connu. Les responsables des trois groupes doivent être renseignés dès que leurs comptes/équipes sont connus ; GitHub n'exige pas une approbation de **chaque** propriétaire d'une même ligne. La règle de revue par chaque groupe concerné est donc également inscrite dans le modèle de PR. Les restrictions effectivement activées sur GitHub sont consignées dans `docs/readiness.md`.

Décision sur les pièces : [stockage sans antivirus](docs/file-storage-decision.md).
