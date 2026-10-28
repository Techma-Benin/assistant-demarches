# Backend

Service NestJS pour les contrats v1. Les contrats partagés et les types générés ne sont pas modifiés.

## Fonctionnalités

- C1 : conversations, messages acceptés en 202, historique d’événements, tickets WebSocket à usage unique, consentement, révocation et projection des demandes.
- Identité : jetons OIDC usager du portail ; relais WhatsApp sous le client `whatsapp-adapter`, scope `conversation:relay` et claim signé `channel_subject` au format E.164. Le Backend résout un pseudonyme stable sans stocker le numéro en clair. Aucun écran de connexion propre à WhatsApp n’est nécessaire.
- C2 : client MCP Streamable HTTP officiel, catalogue v1, schémas d’entrées/sorties, contexte hors arguments du modèle et clés stables pour les actions.
- C3 : GET modèles, outils, fiches, conversations, audit et métriques ; PUT des modèles, outils et fiches existants. L’audit exposé ici couvre les changements de configuration locaux ; il ne remplace pas le journal métier autoritatif du Tooling.
- C4 : ingestion authentifiée, déduplication durable, contrôle des propriétaires, projection des statuts et diffusion aux canaux.
- Agent : adaptateurs Responses et Chat Completions compatibles OpenAI, prompt versionné, outils activés par administration et contrôle des sources retournées. Les changements de configuration affectent les nouveaux traitements ; un traitement commencé conserve sa configuration de modèle.
- Worker BullMQ/Redis : travail durable dans PostgreSQL, ordre par conversation, checkpoints et reprise sans répéter les outils déjà terminés. `STOP` suspend immédiatement les nouvelles actions locales, puis le worker révoque les mandats via le client de contrôle. `HISTORIQUE` expose les actions de la conversation courante.
- Fichiers : 10 Mio maximum, références opaques, stockage local/S3/GCS, état `pending` jusqu’au scan ClamAV, refus d’utilisation avant `clean` et purge à expiration. Les pièces brutes ne sont pas envoyées au modèle.
- WhatsApp : callback statique, événements `message.sent`, acquittement attendu 204, reprise exponentielle jusqu’à 24 h et conservation des échecs.

## Développement

Depuis la racine : `pnpm dev`. Cette commande compile, charge le `.env` de la racine et redémarre le serveur après modification TypeScript. Swagger : `http://localhost:4010/docs`. PostgreSQL et les variables de configuration restent nécessaires ; les migrations sont appliquées automatiquement au démarrage de `pnpm dev`. Le worker se lance séparément. Arrêt : Ctrl+C.

## Démarrage

Depuis la racine, Node 22 et pnpm 10.20.0 :

```sh
pnpm install --frozen-lockfile
pnpm --filter @techma/backend build
pnpm --filter @techma/backend migrate
pnpm --filter @techma/backend seed ./provisioning.json
pnpm --filter @techma/backend start
```

Dans un second processus, avec le même environnement :

```sh
pnpm --filter @techma/backend worker
```

Configurer les variables de `.env.example` dans l’environnement des deux processus ; ce fichier n’est pas chargé automatiquement. Le chemin du provisioning ci-dessus est relatif à `apps/backend`. Les migrations sont versionnées et rejouables. Le provisioning n’insère que les configurations absentes ; les PUT remplacent des ressources existantes et ne créent pas de ressources.

Le service réel et les mocks utilisent 4010 par défaut : choisir des ports distincts pour les lancer ensemble. `/health` vérifie la dernière migration. Utiliser `HOST=0.0.0.0` et une `PUBLIC_BACKEND_URL` HTTPS dans un environnement publié.

### Dépendances locales

Utiliser une base de développement dédiée sur votre PostgreSQL existant, ou le fichier de dépendances facultatif :

```sh
docker compose -f infra/backend-dependencies.compose.yml up -d
```

Cette commande demande `POSTGRES_PASSWORD`. Elle expose PostgreSQL sur 5433, Redis sur 6380 et ClamAV sur 3310, uniquement sur localhost. Ajuster `DATABASE_URL` en conséquence. Ce fichier ne déploie pas Keycloak, le Tooling ou un fournisseur de modèle. Attendre la disponibilité des signatures ClamAV avant de traiter des pièces. Une panne du scanner laisse les pièces non utilisables.

### Identités et consentement

Configurer le realm Keycloak et ses mappers avec l’équipe Interface/Tooling : issuer, JWKS, audience `techma-backend`, claim `administrationId`, rôles ou scopes `admin:read` / `admin:write`. Les jetons RS256 sont vérifiés avec expiration, `nbf` si présent et tolérance de 30 s. Les clients internes sont distincts : `tooling-events` / `events:publish`, `tooling-resources` / `resources:read`, `backend-agent` / `tools:call`, `backend-mandates` / `mandates:grant` et `backend-delivery` / `messages:deliver`.

`IDENTITY_HMAC_KEY` doit être un secret aléatoire stable d’au moins 32 caractères, sauvegardé de manière sûre. Sa perte ou rotation sans migration change les associations d’identités. Aucun jeton public des mocks n’est accepté par l’API réelle.

Les secrets de clients de service restent côté serveur. Configurer leurs audiences dans le fournisseur d’identité. Pour un jeton préémis de développement, `TOOLING_AGENT_TOKEN`, `TOOLING_CONTROL_TOKEN` et `WHATSAPP_DELIVERY_TOKEN` remplacent le flux client credentials. Ces jetons doivent être valides pour les services destinataires.

Pour le consentement, fournir une clé privée RSA PKCS8 via `MANDATE_SIGNING_KEY_FILE`, son identifiant `MANDATE_SIGNING_KEY_ID` et `MANDATE_ISSUER`. Publier sa clé publique JWKS par un canal de déploiement et configurer le Tooling pour vérifier cette preuve avec l’audience `techma-mandate`. Ne jamais déposer la clé privée dans Git. Sans clé ni contrôle Tooling, les routes de consentement échouent explicitement en 503. L’agent ne reçoit pas le jeton de preuve. Le code SMS officiel reste sur le portail.

### Modèles et outils

`MODEL_PROVIDERS_JSON` est un registre de déploiement : nom du fournisseur, `baseUrl` terminant par `/v1/`, protocole `responses` ou `chat-completions`, éventuelle variable `apiKeyEnv` et option `omitTemperature`. Le nom doit correspondre à `ModelConfig.provider`. Un unique modèle actif est requis par administration ; sinon le travail reste en erreur explicite plutôt que de choisir arbitrairement. Le prompt livré porte la version `agent-v1`.

Les serveurs MCP doivent être dans `MCP_ALLOWED_URLS`. La référence `backend-agent` utilise le client de service dédié ; les autres références sont résolues exclusivement par le registre `MCP_SECRET_REFERENCES`. Une URL saisie dans la console ne suffit pas à autoriser une destination réseau. Les redirections HTTP sont refusées.

Exemple synthétique de provisioning :

```json
{
  "administrationId": "demo-administration",
  "models": [{"id":"primary","provider":"openai","model":"MODEL_ID","promptVersion":"agent-v1","temperature":0.2,"active":true}],
  "tools": [{"name":"procedures.get","enabled":true,"serverUrl":"http://127.0.0.1:4020/mcp","secretRef":"backend-agent"}],
  "procedures": []
}
```

Configurer les huit outils v1 nécessaires au parcours. Les fiches doivent être provisionnées, puis validées par une administration ; les API privées ne servent que les fiches validées. Une configuration de modèle persistée ne garantit pas que le modèle ou son endpoint prend en charge toutes les capacités : vérifier chaque profil avant activation.

### Stockage

`STORAGE_DRIVER=local` utilise un répertoire privé de développement. `s3` utilise `STORAGE_BUCKET`, `AWS_REGION`, les credentials AWS standard et, pour un service compatible, `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE`. `gcs` utilise `STORAGE_BUCKET` et les credentials GCS du déploiement. Les adaptateurs existent ; leur activation demande aussi les permissions et ressources correspondantes. Migrer des fichiers existants reste une opération distincte.

Pour essayer Swagger sans fournisseur d’identité local : activer `BACKEND_DEV_AUTH=true` dans le `.env`, relancer `pnpm dev` et cliquer **Tester comme usager** sur `/docs`. Les identités RS256 temporaires sont réservées au lancement de développement sur localhost. La production conserve la vérification OIDC normale.

## Documentation interactive

Le [guide de test complet](docs/testing.md) explique les prérequis, les identités, cinq scénarios et les erreurs ; il est aussi accessible sur `/docs/guide`. Chaque route Swagger contient ses étapes et des exemples. Les descriptions sont enrichies au service de la documentation, sans modifier les contrats partagés.

Après démarrage, ouvrir `http://localhost:4010/docs`. Swagger UI propose les quatre contrats du Backend et permet de tester les routes sur le serveur courant. Fournir un jeton valide via **Authorize**, ainsi que les en-têtes requis (`traceparent`, `Idempotency-Key`, selon la route). Les jetons ne sont pas conservés après rechargement. La documentation est publique, les opérations restent authentifiées. Les fichiers Swagger sont servis localement, sans CDN.

## Conservation et reprise

Les événements sont conservés 48 h à compter de leur persistance, ce qui couvre le minimum contractuel de 24 h. Les fichiers expirent après 24 h. Les réservations d’idempotence durent au moins 24 h. Les entrées traitées et résultats techniques sont nettoyés après 48 h ; les conversations, identités et preuves de consentement restent soumises à la politique du futur pilote, à définir avant données réelles.

Le worker doit tourner pour les traitements, livraisons, scans et nettoyages. Un traitement s’arrête avec un message explicite après douze échecs ou 24 h, sans relancer une action au-delà de la fenêtre de reprise. Le callback WhatsApp échoué après 24 h reste signalé pour traitement d’exploitation. Les erreurs 401/403 du callback produisent une alerte de configuration sur stderr.

## Vérification et limites

```sh
pnpm --filter @techma/backend test
pnpm check
```

Les tests utilisent PostgreSQL jetable et des fournisseurs locaux synthétiques, avec de vraies signatures JWT et les vrais transports HTTP/MCP/WebSocket. `PG_BIN` peut désigner les binaires PostgreSQL ; ne pas exécuter le cluster de test en root. En CI, `BACKEND_TEST_DATABASE_URL` doit cibler une base dédiée finissant par `_test` ; chaque test utilise son propre schéma temporaire.

Le test du processus worker utilise `REDIS_TEST_URL`, ou un binaire Redis local (`REDIS_TEST_BINARY`). Il est ignoré si aucun Redis de test n’est disponible ; la CI fournit Redis et exécute ce scénario. Les tests ne ciblent jamais `DATABASE_URL` par défaut.

À valider avant un pilote : realm Keycloak réel et échange de jetons WhatsApp, services des autres équipes, profils de modèles réels, stockage cloud et permissions, ClamAV réel, TLS/chiffrement, sauvegardes, supervision et jeu d’évaluation métier. Le masquage de motifs sensibles et la vérification des références de sources ne constituent pas une garantie d’anonymisation complète ou d’exactitude des réponses. Les traces OpenTelemetry et l’export du journal autoritatif Tooling restent à intégrer.

Les messages audio/images/fichiers sont acceptés comme références contrôlées mais aucune transcription/OCR n’est encore branchée : l’assistant demande une description écrite. La phase v1 prépare un lien officiel et ne déclare pas un dépôt administratif autonome. La création/suppression publique de modèles ou de serveurs MCP n’est pas ajoutée au contrat actif.

## Logs de diagnostic

Le worker écrit des lignes JSON sur stderr : `agent.processing_failed`, `agent.processing_exhausted`, `worker.job_failed`, erreurs de file et de maintenance. Chercher `conversationId`, `messageId` et `traceId` pour suivre un traitement. Chaque échec comprend le numéro de tentative, le code et, pour un refus IA, le fournisseur, le modèle, le statut HTTP distant, l’identifiant de requête disponible et une raison classifiée. Exemple : `upstreamStatus: 403`, `reason: provider_network_access_denied` signifie que l’appel distant a été refusé pour une raison d’accès réseau ; ce n’est pas une erreur du WebSocket.

Les corps de messages, jetons, clés et réponses brutes des fournisseurs ne sont pas journalisés. La dernière erreur structurée est conservée dans `backend_messages.last_error` après abandon ; elle est effacée après une réussite effective. Un ancien échec dont la cause avait déjà été effacée n’est pas récupérable rétroactivement.
